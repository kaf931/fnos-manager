import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
test('terminal HTTP enforces admin UID CSRF and owner isolation', async () => {
  const f = await appFixture();
  try {
    const body = { name: 'test', kind: 'local', username: 'tester' };
    assert.equal((await f.call('/connections', 'POST', body, { 'x-trim-userid': '' })).status, 403);
    assert.equal(
      (await f.call('/connections', 'POST', body, { 'x-trim-isadmin': 'false' })).status,
      403,
    );
    assert.equal(
      (await f.call('/connections', 'POST', body, { 'x-deskicons-token': 'bad' })).status,
      403,
    );
    const r = await f.call('/connections', 'POST', body);
    assert.equal(r.status, 201);
    const c = await r.json();
    assert.equal(
      (await (await f.call('/connections', 'GET', null, { 'x-trim-userid': '1001' })).json())
        .length,
      0,
    );
    assert.equal(
      (await f.call('/connections/' + c.id, 'DELETE', null, { 'x-trim-userid': '1001' })).status,
      404,
    );
    const s = await f.call('/sessions', 'POST', { connectionId: c.id });
    assert.equal(s.status, 201);
    const session = await s.json();
    const second = await (await f.call('/sessions', 'POST', { connectionId: c.id })).json();
    assert.ok(second.id);
    await f.call('/sessions/' + second.id, 'DELETE');
    assert.equal((await f.call('/connections/' + c.id, 'PUT', body)).status, 409);
    assert.equal(
      (await f.call('/sessions/' + session.id, 'DELETE', null, { 'x-trim-userid': '1001' })).status,
      404,
    );
    assert.equal((await f.call('/sessions/' + session.id, 'DELETE')).status, 204);
    assert.equal((await f.call('/connections/' + c.id, 'DELETE')).status, 204);
  } finally {
    await f.close();
  }
});
