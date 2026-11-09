import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import { TerminalStore } from '../server/terminal/store.js';
import { TerminalSession } from '../server/terminal/session.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
import { decodeTerminalEvent } from '../.web-test/terminal-protocol.js';
import { createConnectionDiagnostics } from '../.web-test/terminal-diagnostics.js';
async function sessionFixture(t, withSftp = true) {
  const dir = await mkdtemp(os.tmpdir() + '/ssh-diagnostic-');
  const commands = [];
  const ssh = await sshFixture({
    sftpRoot: withSftp ? dir : undefined,
    execHandler: (command, stream) => {
      commands.push(command);
      stream.end();
    },
  });
  const store = await new TerminalStore(dir).init();
  const e = events();
  const session = new TerminalSession({
    connection: { host: '127.0.0.1', port: ssh.port, username: 'tester' },
    ownerUid: '1000',
    store,
    emit: e.emit,
  });
  t.after(async () => {
    session.close();
    await ssh.close();
    await store.close?.();
    await rm(dir, { recursive: true, force: true });
  });
  return { session, e, ssh, commands };
}
test('real SSH diagnostics wait for trust, pass five stages, and never execute a diagnostic command', async (t) => {
  const { session, e, ssh, commands } = await sessionFixture(t);
  session.start();
  const host = await e.wait((x) => x.type === 'host-key');
  assert.equal(ssh.auth.length, 0);
  assert.ok(
    e.items.some(
      (x) => x.type === 'diagnostic' && x.stage === 'fingerprint' && x.status === 'waiting',
    ),
  );
  await assert.rejects(session.acceptHost({ fingerprint: 'wrong', replace: true }));
  assert.equal(ssh.auth.length, 0);
  await session.acceptHost({ fingerprint: host.fingerprint, replace: false });
  await e.wait((x) => x.type === 'credentials-required');
  session.authenticate({ method: 'password', password: 'fixture-password' });
  await e.wait((x) => x.type === 'diagnostic' && x.stage === 'sftp' && x.status === 'passed');
  for (const stage of ['network', 'handshake', 'fingerprint', 'authentication', 'sftp']) {
    assert.ok(
      e.items.some((x) => x.type === 'diagnostic' && x.stage === stage && x.status === 'passed'),
      stage,
    );
  }
  assert.deepEqual(commands, []);
  assert.doesNotMatch(
    JSON.stringify(e.items.filter((x) => x.type === 'diagnostic')),
    /fixture-password|privateKey|passphrase/,
  );
});
test('unavailable SFTP is diagnosed while the authenticated shell remains connected', async (t) => {
  const { session, e } = await sessionFixture(t, false);
  session.start();
  const host = await e.wait((x) => x.type === 'host-key');
  await session.acceptHost({ fingerprint: host.fingerprint, replace: false });
  await e.wait((x) => x.type === 'credentials-required');
  session.authenticate({ method: 'password', password: 'fixture-password' });
  await e.wait((x) => x.type === 'diagnostic' && x.stage === 'sftp' && x.status === 'failed');
  assert.equal(session.state, 'connected');
});
test('bad credentials identify authentication failure without exposing the supplied secret', async (t) => {
  const { session, e } = await sessionFixture(t);
  session.start();
  const host = await e.wait((x) => x.type === 'host-key');
  await session.acceptHost({ fingerprint: host.fingerprint, replace: false });
  await e.wait((x) => x.type === 'credentials-required');
  session.authenticate({ method: 'password', password: 'secret-never-emit' });
  await e.wait(
    (x) => x.type === 'diagnostic' && x.stage === 'authentication' && x.status === 'failed',
  );
  assert.doesNotMatch(JSON.stringify(e.items), /secret-never-emit/);
});
test('TCP reachable endpoint without SSH identifies the handshake timeout', async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const e = events();
  const session = new TerminalSession({
    connection: { host: '127.0.0.1', port: server.address().port, username: 'tester' },
    ownerUid: '1000',
    store: {},
    emit: e.emit,
    timers: { handshake: 40, wait: 40 },
  });
  t.after(async () => {
    session.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  session.start();
  await e.wait((x) => x.type === 'diagnostic' && x.stage === 'handshake' && x.status === 'failed');
  assert.ok(
    e.items.some((x) => x.type === 'diagnostic' && x.stage === 'network' && x.status === 'passed'),
  );
  assert.equal(session.closed, true);
});
test('diagnostic protocol validates messages and prints only sanitized failures once per connection attempt', () => {
  const valid = {
    type: 'diagnostic',
    stage: 'fingerprint',
    status: 'waiting',
    message: '等待核对指纹',
    at: Date.now(),
  };
  assert.deepEqual(decodeTerminalEvent(valid), valid);
  for (const bad of [
    { stage: 'credentials' },
    { status: 'trusted-automatically' },
    { at: NaN },
    { message: 'x'.repeat(513) },
  ]) {
    assert.throws(() => decodeTerminalEvent({ ...valid, ...bad }), /无法识别/);
  }
  const lines = [];
  const diagnostic = createConnectionDiagnostics((line) => lines.push(line));
  diagnostic.accept(valid);
  diagnostic.accept({ ...valid, status: 'passed' });
  assert.equal(lines.length, 0);
  const failed = { ...valid, status: 'failed', message: '主机\x1b[2J\r\n不可达' };
  diagnostic.accept(failed);
  diagnostic.accept(failed);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /主机指纹失败/);
  assert.doesNotMatch(lines[0], /[\x00-\x1f\x7f-\x9f]/);
  assert.equal(diagnostic.hasFailure(), true);
  assert.equal(diagnostic.matchesFailure(failed.message), true);
  assert.equal(diagnostic.matchesFailure('另一个连接错误'), false);
  diagnostic.reset();
  assert.equal(diagnostic.hasFailure(), false);
  diagnostic.accept(failed);
  assert.equal(lines.length, 2);
});
