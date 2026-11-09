import test from 'node:test';
import assert from 'node:assert/strict';
import ssh2 from 'ssh2';
import { sshFixture } from './fixtures/ssh-server.js';
import { executeAiCommand } from '../server/terminal/ai/executor.js';
async function setup(t, handler) {
  const fixture = await sshFixture({ execHandler: handler });
  t.after(() => fixture.close());
  const client = new ssh2.Client();
  t.after(() => client.destroy());
  await new Promise((r, j) =>
    client.once('ready', r).once('error', j).connect({
      host: '127.0.0.1',
      port: fixture.port,
      username: 'tester',
      password: 'fixture-password',
    }),
  );
  return { client, state: 'connected', closed: false };
}
test('AI executor collects real SSH stdout stderr and exit code without terminal stdin', async (t) => {
  const session = await setup(t, (cmd, s) => {
    assert.equal(cmd, 'pwd');
    s.write('/home/test\n');
    s.stderr.write('warning');
    s.exit(0);
    s.end();
  });
  const r = await executeAiCommand(session, 'pwd', { signal: new AbortController().signal });
  assert.equal(r.stdout, '/home/test\n');
  assert.equal(r.stderr, 'warning');
  assert.equal(r.exitCode, 0);
  assert.equal(r.status, 'success');
});
test('AI executor distinguishes missing or nonzero exit, bounds output and does not split UTF8', async (t) => {
  const session = await setup(t, (cmd, s) => {
    s.write(cmd === 'large' ? '中'.repeat(30000) : 'x');
    if (cmd !== 'missing') s.exit(cmd === 'bad' ? 2 : 0);
    s.end();
  });
  for (const cmd of ['bad', 'missing'])
    assert.equal(
      (await executeAiCommand(session, cmd, { signal: new AbortController().signal })).status,
      'failed',
    );
  const r = await executeAiCommand(session, 'large', { signal: new AbortController().signal });
  assert.equal(r.truncated, true);
  assert.ok(Buffer.byteLength(r.stdout) <= 65536);
  assert.ok(!r.stdout.includes('\ufffd'));
});
test('AI executor times out and supports cancellation and pre-aborted calls', async (t) => {
  const session = await setup(t, () => {});
  assert.equal(
    (
      await executeAiCommand(session, 'hang', {
        signal: new AbortController().signal,
        timeoutMs: 30,
      })
    ).status,
    'timeout',
  );
  const c = new AbortController();
  const p = executeAiCommand(session, 'hang', { signal: c.signal });
  setTimeout(() => c.abort(), 30);
  assert.equal((await p).status, 'cancelled');
  assert.equal(
    (await executeAiCommand(session, 'never', { signal: c.signal })).status,
    'cancelled',
  );
});
