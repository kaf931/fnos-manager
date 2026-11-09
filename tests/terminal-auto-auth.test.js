import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { appFixture } from './fixtures/terminal-app.js';
import { sshFixture, events } from './fixtures/ssh-server.js';
for (const method of ['password', 'privateKey', 'encrypted'])
  test('saved credentials auto-connect only after host trust: ' + method, async () => {
    const f = await appFixture(),
      ssh = await sshFixture();
    let ws;
    try {
      const credentials =
        method === 'password'
          ? { password: 'fixture-password' }
          : {
              privateKey: method === 'encrypted' ? ssh.encryptedKey : ssh.userKey,
              passphrase: method === 'encrypted' ? 'fixture-passphrase' : '',
            };
      const payload = {
        name: 'auto',
        kind: 'remote',
        host: '127.0.0.1',
        port: ssh.port,
        username: 'tester',
        authMethod: method === 'password' ? 'password' : 'privateKey',
        credentials,
      };
      const response = await f.call('/connections', 'POST', payload);
      assert.equal(response.status, 201);
      const c = await response.json();
      assert.equal(c.hasCredentials, true);
      assert.equal(c.credentialBox, undefined);
      const list = await (await f.call('/connections')).text();
      assert.deepEqual(
        JSON.parse(list)[0].credentials,
        method === 'password'
          ? { method: 'password', ...credentials }
          : { method: 'privateKey', ...credentials },
      );
      assert.equal(
        (await f.call('/connections', 'GET', undefined, { 'x-trim-userid': '1001' })).status,
        200,
      );
      for (let n = 0; n < 2; n++) {
        const created = await f.call('/sessions', 'POST', { connectionId: c.id });
        assert.equal(created.status, 201);
        const session = await created.json(),
          e = events();
        ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/app/deskicons/terminal/ws', {
          headers: f.headers,
        });
        ws.on('message', (data) => e.emit(JSON.parse(data)));
        await new Promise((r) => ws.once('open', r));
        ws.send(JSON.stringify({ type: 'authenticate', id: session.id, ticket: session.ticket }));
        if (n === 0) {
          const key = await e.wait((x) => x.type === 'host-key');
          assert.equal(ssh.auth.length, 0);
          ws.send(JSON.stringify({ type: 'trust-host', fingerprint: key.fingerprint }));
        }
        await e.wait((x) => x.type === 'state' && x.state === 'connected');
        assert.equal(
          e.items.some((x) => x.type === 'credentials-required'),
          false,
        );
        if (n === 1)
          assert.equal(
            e.items.some((x) => x.type === 'host-key'),
            false,
          );
        ws.send(JSON.stringify({ type: 'input', data: 'hello\n' }));
        await e.wait(
          (x) =>
            x.type === 'output' && Buffer.from(x.data, 'base64').toString().includes('echo:hello'),
        );
        ws.close();
        await new Promise((r) => ws.once('close', r));
        const closed = await f.call('/sessions/' + session.id, 'DELETE');
        assert.ok([204, 404].includes(closed.status));
      }
    } finally {
      ws?.terminate();
      await f.close();
      await ssh.close();
    }
  });
