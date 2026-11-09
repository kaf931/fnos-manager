import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
test('VNC routes enforce validation, admin, CSRF, ownership, and open-session edit locks', async () => {
  const f = await appFixture();
  try {
    const call = (p, method = 'GET', body, extra = {}) =>
      fetch(f.base + '/vnc' + p, {
        method,
        headers: { ...f.headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    const input = {
      name: 'Test VNC',
      protocol: 'vnc',
      host: '192.168.1.2',
      port: 5900,
      username: '',
      password: 'secret',
    };
    assert.equal(
      (await call('/connections', 'POST', input, { 'x-trim-isadmin': 'false' })).status,
      403,
    );
    assert.equal(
      (await call('/connections', 'POST', input, { 'x-deskicons-token': 'wrong' })).status,
      403,
    );
    assert.equal((await call('/connections', 'POST', { ...input, protocol: 'rdp' })).status, 400);
    assert.equal((await call('/connections', 'POST', { ...input, port: '5900' })).status, 400);
    assert.equal((await call('/connections', 'POST', { ...input, unexpected: true })).status, 400);
    const create = await call('/connections', 'POST', input);
    assert.equal(create.status, 201);
    const { id } = await create.json();
    assert.equal((await (await call('/connections')).json())[0].password, 'secret');
    assert.deepEqual(
      await (await call('/connections', 'GET', undefined, { 'x-trim-userid': '1001' })).json(),
      [],
    );
    assert.equal(
      (await call('/sessions', 'POST', { connectionId: id }, { 'x-trim-userid': '1001' })).status,
      404,
    );
    const session = await (await call('/sessions', 'POST', { connectionId: id })).json();
    assert.match(session.ticket, /^[a-f0-9]{64}$/);
    assert.equal(
      (
        await call('/sessions/' + session.id + '/logs', 'GET', undefined, {
          'x-trim-userid': '1001',
        })
      ).status,
      404,
    );
    const logs = await (await call('/sessions/' + session.id + '/logs')).json();
    assert.ok(logs.items.some((row) => row.stage === 'session'));
    assert.doesNotMatch(JSON.stringify(logs), /secret|password|ticket/);
    assert.equal((await call('/connections/' + id, 'PUT', input)).status, 409);
    assert.equal(
      (await call('/sessions/' + session.id, 'DELETE', undefined, { 'x-trim-userid': '1001' }))
        .status,
      404,
    );
    assert.equal((await call('/sessions/' + session.id, 'DELETE')).status, 204);
    assert.equal((await call('/sessions/' + session.id + '/logs')).status, 404);
    assert.equal((await call('/connections/' + id, 'PUT', input)).status, 200);
    assert.equal((await call('/connections/' + id, 'DELETE')).status, 204);
  } finally {
    await f.close();
  }
});
