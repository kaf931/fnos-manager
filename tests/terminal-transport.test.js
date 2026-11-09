import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
import { TicketVault } from '../server/terminal/transport.js';
test('tickets expire, bind owner and origin and cannot replay', () => {
  let now = 0;
  const v = new TicketVault(() => now),
    t = v.issue({ ownerUid: '1000', origin: 'https://nas', sessionId: 'one' });
  assert.equal(v.consume(t, '1001', 'https://nas'), null);
  assert.equal(v.consume(t, '1000', 'https://evil'), null);
  assert.equal(v.consume(t, '1000', 'https://nas').sessionId, 'one');
  assert.equal(v.consume(t, '1000', 'https://nas'), null);
  const t2 = v.issue({ ownerUid: '1000', origin: 'https://nas', sessionId: 'two' });
  now = 30001;
  assert.equal(v.consume(t2, '1000', 'https://nas'), null);
});
test('WS with rewritten Host authenticates then prompts trust; mismatched origin cannot use ticket', async () => {
  const f = await appFixture(),
    ssh = await sshFixture();
  let ws, bad;
  try {
    const c = await (
      await f.call('/connections', 'POST', {
        name: 'fixture',
        kind: 'remote',
        host: '127.0.0.1',
        port: ssh.port,
        username: 'tester',
      })
    ).json();
    const s = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json();
    const url = f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws';
    bad = new WebSocket(url, { headers: { ...f.headers, Origin: 'http://evil' } });
    const errors = events();
    bad.on('message', (data) => errors.emit(JSON.parse(data)));
    await new Promise((r) => bad.once('open', r));
    bad.send(JSON.stringify({ type: 'authenticate', id: s.id, ticket: s.ticket }));
    await new Promise((r) => bad.once('close', r));
    ws = new WebSocket(url, { headers: f.headers });
    const e = events();
    ws.on('message', (data) => e.emit(JSON.parse(data)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'authenticate', id: s.id, ticket: s.ticket }));
    const k = await e.wait((x) => x.type === 'host-key');
    assert.equal(ssh.auth.length, 0);
    ws.send(JSON.stringify({ type: 'trust-host', fingerprint: k.fingerprint, replace: false }));
    await e.wait((x) => x.type === 'credentials-required');
    ws.send(
      JSON.stringify({ type: 'credentials', method: 'password', password: 'fixture-password' }),
    );
    await e.wait((x) => x.type === 'state' && x.state === 'connected');
    ws.send(JSON.stringify({ type: 'input', data: 'hello\n' }));
    await e.wait(
      (x) => x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('echo:hello'),
    );
    ws.close();
    await new Promise((r) => ws.once('close', r));
  } finally {
    ws?.terminate();
    bad?.terminate();
    await f.close();
    await ssh.close();
  }
});
test('WS rejects invalid paths, missing identity, missing authentication and malformed messages', async () => {
  const f = await appFixture();
  try {
    const url = f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws';
    for (const [path, headers] of [
      [url + '?ticket=bad', f.headers],
      [url, { ...f.headers, 'x-trim-userid': '' }],
      [url, { ...f.headers, 'x-trim-isadmin': 'false' }],
    ]) {
      const ws = new WebSocket(path, { headers });
      await new Promise((resolve, reject) => {
        ws.once('error', resolve);
        ws.once('open', () => reject(new Error('unexpected upgrade')));
      });
    }
    const silent = new WebSocket(url, { headers: f.headers });
    await new Promise((r) => silent.once('open', r));
    const started = Date.now();
    await new Promise((r) => silent.once('close', r));
    assert.ok(Date.now() - started >= 4500);
    const invalid = new WebSocket(url, { headers: f.headers });
    invalid.on('error', () => {});
    await new Promise((r) => invalid.once('open', r));
    invalid.send('{bad');
    await new Promise((r) => invalid.once('close', r));
  } finally {
    await f.close();
  }
});
test('unacknowledged terminal output closes at bounded window even on fast network', async () => {
  const f = await appFixture(),
    ssh = await sshFixture();
  let ws;
  try {
    const c = await (
        await f.call('/connections', 'POST', {
          name: 'flood',
          kind: 'remote',
          host: '127.0.0.1',
          port: ssh.port,
          username: 'tester',
        })
      ).json(),
      s = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json(),
      e = events();
    ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws', {
      headers: f.headers,
    });
    ws.on('message', (data) => e.emit(JSON.parse(data)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'authenticate', id: s.id, ticket: s.ticket }));
    const k = await e.wait((x) => x.type === 'host-key');
    ws.send(JSON.stringify({ type: 'trust-host', fingerprint: k.fingerprint }));
    await e.wait((x) => x.type === 'credentials-required');
    ws.send(
      JSON.stringify({ type: 'credentials', method: 'password', password: 'fixture-password' }),
    );
    await e.wait((x) => x.type === 'state' && x.state === 'connected');
    ws.send(JSON.stringify({ type: 'input', data: 'flood' }));
    await e.wait((x) => x.type === 'error' && x.code === 'OUTPUT_LIMIT');
    await new Promise((r) => (ws.readyState === WebSocket.CLOSED ? r() : ws.once('close', r)));
    const next = await f.call('/sessions', 'POST', { connectionId: c.id });
    assert.equal(next.status, 201);
  } finally {
    ws?.terminate();
    await f.close();
    await ssh.close();
  }
});
