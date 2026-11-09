import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { TerminalStore } from '../server/terminal/store.js';
import { TerminalSession } from '../server/terminal/session.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
async function setup() {
  const fixture = await sshFixture(),
    dir = await mkdtemp(os.tmpdir() + '/ssh-session-'),
    store = await new TerminalStore(dir).init();
  return {
    fixture,
    store,
    dir,
    cleanup: async () => {
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
for (const method of ['password', 'privateKey', 'encrypted'])
  test('host trust precedes credentials and PTY works: ' + method, async () => {
    const env = await setup(),
      e = events(),
      s = new TerminalSession({
        connection: { host: '127.0.0.1', port: env.fixture.port, username: 'tester' },
        ownerUid: '1000',
        store: env.store,
        emit: e.emit,
      });
    try {
      assert.throws(() => s.input('ls'));
      s.start();
      const key = await e.wait((x) => x.type === 'host-key');
      assert.equal(env.fixture.auth.length, 0);
      assert.match(key.fingerprint, /^SHA256:/);
      await s.acceptHost({ fingerprint: key.fingerprint, replace: false });
      await e.wait((x) => x.type === 'credentials-required');
      s.authenticate(
        method === 'password'
          ? { method: 'password', password: 'fixture-password' }
          : {
              method: 'privateKey',
              privateKey: method === 'encrypted' ? env.fixture.encryptedKey : env.fixture.userKey,
              passphrase: method === 'encrypted' ? 'fixture-passphrase' : undefined,
            },
      );
      await e.wait((x) => x.type === 'state' && x.state === 'connected');
      s.resize({ cols: 90, rows: 30 });
      s.input('hello\n');
      await e.wait(
        (x) =>
          x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('echo:hello'),
      );
      assert.throws(() => s.input('x'.repeat(16385)));
      assert.throws(() => s.resize({ cols: 0, rows: 1 }));
      s.close();
      s.close();
      assert.equal(s.state, 'disconnected');
    } finally {
      s.close();
      await env.cleanup();
    }
  });
test('changed host key requires explicit replacement', async () => {
  const env = await setup(),
    e = events();
  await env.store.trustHostKey('1000', {
    host: '127.0.0.1',
    port: env.fixture.port,
    algorithm: 'ssh-rsa',
    key: 'old',
    fingerprint: 'SHA256:old',
  });
  const s = new TerminalSession({
    connection: { host: '127.0.0.1', port: env.fixture.port, username: 'tester' },
    ownerUid: '1000',
    store: env.store,
    emit: e.emit,
  });
  try {
    s.start();
    const k = await e.wait((x) => x.type === 'host-key');
    assert.equal(k.changed, true);
    await assert.rejects(() => s.acceptHost({ fingerprint: k.fingerprint, replace: false }));
    assert.equal(env.fixture.auth.length, 0);
    await s.acceptHost({ fingerprint: k.fingerprint, replace: true });
    await e.wait((x) => x.type === 'credentials-required');
    s.authenticate({ method: 'password', password: 'bad' });
    const err = await e.wait((x) => x.type === 'error');
    assert.equal(err.code, 'AUTH_FAILED');
    assert.ok(!JSON.stringify(e.items).includes('bad'));
  } finally {
    s.close();
    await env.cleanup();
  }
});
test('host confirmation timeout ends SSH before authentication', async () => {
  const env = await setup(),
    e = events(),
    s = new TerminalSession({
      connection: { host: '127.0.0.1', port: env.fixture.port, username: 'tester' },
      ownerUid: '1000',
      store: env.store,
      emit: e.emit,
      timers: { handshake: 1000, wait: 30 },
    });
  try {
    s.start();
    await e.wait((x) => x.type === 'host-key');
    await e.wait((x) => x.type === 'error' && x.code === 'TIMEOUT');
    assert.equal(s.state, 'disconnected');
    assert.equal(env.fixture.auth.length, 0);
  } finally {
    s.close();
    await env.cleanup();
  }
});
test('independent trust and credentials waits do not share an SSH library deadline', async () => {
  const env = await setup(),
    e = events(),
    s = new TerminalSession({
      connection: { host: '127.0.0.1', port: env.fixture.port, username: 'tester' },
      ownerUid: '1000',
      store: env.store,
      emit: e.emit,
      timers: { handshake: 200, wait: 500 },
    });
  try {
    s.start();
    const key = await e.wait((x) => x.type === 'host-key');
    await new Promise((r) => setTimeout(r, 400));
    await s.acceptHost({ fingerprint: key.fingerprint, replace: false });
    await e.wait((x) => x.type === 'credentials-required');
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(s.state, 'credentials');
    s.authenticate({ method: 'password', password: 'fixture-password' });
    await e.wait((x) => x.type === 'state' && x.state === 'connected');
  } finally {
    s.close();
    await env.cleanup();
  }
});
