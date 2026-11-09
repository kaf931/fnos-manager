import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
test('two real SSH transports isolate output and closing A leaves B usable', async () => {
  const f = await appFixture(),
    ssh = await sshFixture(),
    clients = [];
  try {
    async function connect(name) {
      const c = await (
          await f.call('/connections', 'POST', {
            name,
            kind: 'remote',
            host: '127.0.0.1',
            port: ssh.port,
            username: 'tester',
            authMethod: 'password',
            credentials: { password: 'fixture-password' },
          })
        ).json(),
        s = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json(),
        e = events(),
        ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws', {
          headers: f.headers,
        });
      clients.push(ws);
      ws.on('message', (data) => e.emit(JSON.parse(data)));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'authenticate', ...s }));
      return { ws, e, s };
    }
    const a = await connect('A'),
      b = await connect('B');
    for (const c of [a, b]) {
      const ready = await c.e.wait(
        (x) => x.type === 'host-key' || (x.type === 'state' && x.state === 'connected'),
      );
      if (ready.type === 'host-key')
        c.ws.send(JSON.stringify({ type: 'trust-host', fingerprint: ready.fingerprint }));
      await c.e.wait((x) => x.type === 'state' && x.state === 'connected');
    }
    a.ws.send(JSON.stringify({ type: 'input', data: 'marker-A' }));
    b.ws.send(JSON.stringify({ type: 'input', data: 'marker-B' }));
    for (const [c, mark] of [
      [a, 'marker-A'],
      [b, 'marker-B'],
    ])
      await c.e.wait(
        (x) => x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes(mark),
      );
    assert.ok(
      !a.e.items.some(
        (x) => x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('marker-B'),
      ),
    );
    assert.ok(
      !b.e.items.some(
        (x) => x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('marker-A'),
      ),
    );
    assert.equal((await f.call('/sessions/' + a.s.id, 'DELETE')).status, 204);
    b.ws.send(JSON.stringify({ type: 'input', data: 'still-B' }));
    await b.e.wait(
      (x) => x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('still-B'),
    );
  } finally {
    for (const ws of clients) ws.terminate();
    await f.close();
    await ssh.close();
  }
});
