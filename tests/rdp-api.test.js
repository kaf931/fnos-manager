import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
test('RDP validates credentials and isolates saved connections by owner', async () => {
  const f = await appFixture();
  try {
    const call = (p, method = 'GET', body, extra = {}) =>
      fetch(f.base + '/rdp' + p, {
        method,
        headers: { ...f.headers, ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    const input = {
      name: 'Windows',
      protocol: 'rdp',
      host: 'win.local',
      port: 3389,
      username: 'user',
      password: 'secret',
      domain: '',
    };
    assert.equal((await call('/connections', 'POST', { ...input, port: 0 })).status, 400);
    assert.equal((await call('/connections', 'POST', { ...input, ignoreCert: true })).status, 400);
    assert.equal(
      (await call('/connections', 'POST', input, { 'x-trim-isadmin': 'false' })).status,
      403,
    );
    const response = await call('/connections', 'POST', input);
    assert.equal(response.status, 201);
    const { id } = await response.json();
    assert.equal((await (await call('/connections')).json())[0].protocol, 'rdp');
    let row = (await (await call('/connections')).json())[0];
    assert.equal(row.security, 'any');
    assert.equal(row.certificatePolicy, 'strict');
    for (const invalid of [{ security: 'off' }, { certificatePolicy: 'invalid' }])
      assert.equal((await call('/connections/' + id, 'PUT', { ...input, ...invalid })).status, 400);
    assert.equal(
      (
        await call('/connections/' + id, 'PUT', {
          ...input,
          security: 'tls',
          certificatePolicy: 'tofu',
        })
      ).status,
      200,
    );
    // Older callers omitting new options must not reset a saved trust policy.
    assert.equal((await call('/connections/' + id, 'PUT', input)).status, 200);
    row = (await (await call('/connections')).json())[0];
    assert.equal(row.security, 'tls');
    assert.equal(row.certificatePolicy, 'tofu');
    assert.deepEqual(
      await (await call('/connections', 'GET', undefined, { 'x-trim-userid': '1001' })).json(),
      [],
    );
    assert.equal(
      (await call('/connections/' + id, 'PUT', input, { 'x-trim-userid': '1001' })).status,
      404,
    );
    assert.equal((await call('/connections/' + id, 'DELETE')).status, 204);
  } finally {
    await f.close();
  }
});
