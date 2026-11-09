import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
test('monitor reads over independent SSH channel with owner and connection checks', async () => {
  let execs = 0;
  const f = await appFixture(),
    ssh = await sshFixture({
      execOutput: (command) => {
        execs++;
        assert.ok(command.includes('/proc/stat'));
        return 'cpu 100 0 100 800 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 300 kB\n__DISK__\n/dev/sda 100 40 60 40% /\n';
      },
    });
  let ws;
  try {
    const c = await (
      await f.call('/connections', 'POST', {
        name: 'monitor',
        kind: 'remote',
        host: '127.0.0.1',
        port: ssh.port,
        username: 'tester',
        authMethod: 'password',
        credentials: { password: 'fixture-password' },
      })
    ).json();
    const session = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json(),
      url = '/sessions/' + session.id + '/monitor';
    assert.equal((await f.call(url)).status, 409);
    const e = events();
    ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws', {
      headers: f.headers,
    });
    ws.on('message', (d) => e.emit(JSON.parse(d)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'authenticate', id: session.id, ticket: session.ticket }));
    const key = await e.wait((x) => x.type === 'host-key');
    ws.send(JSON.stringify({ type: 'trust-host', fingerprint: key.fingerprint }));
    await e.wait((x) => x.type === 'state' && x.state === 'connected');
    assert.equal((await f.call(url, 'GET', null, { 'x-trim-userid': '1001' })).status, 404);
    assert.equal((await f.call(url, 'GET', null, { 'x-trim-isadmin': 'false' })).status, 403);
    const response = await f.call(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.memory.percent, 70);
    assert.equal(data.disk.percent, 40);
    await f.call(url);
    assert.equal(execs, 1);
    ws.send(JSON.stringify({ type: 'input', data: 'still works\n' }));
    await e.wait(
      (x) =>
        x.type === 'output' &&
        Buffer.from(x.data, 'base64').toString().includes('echo:still works'),
    );
    assert.equal(
      e.items.some(
        (x) => x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('__MEM__'),
      ),
      false,
    );
    await f.call('/sessions/' + session.id, 'DELETE');
    assert.equal((await f.call(url)).status, 404);
  } finally {
    ws?.terminate();
    await f.close();
    await ssh.close();
  }
});
