import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
test('self update endpoints enforce administrator, CSRF and strict version-only input', async (t) => {
  const f = await appFixture();
  t.after(() => f.close());
  const call = (route, method = 'GET', body, extra = {}) =>
    fetch(f.base + '/updates' + route, {
      method,
      headers: { ...f.headers, ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.deepEqual(await (await call('/settings')).json(), {
    mode: 'manual',
    downloadRoute: 'direct',
  });
  assert.equal((await call('/settings', 'PUT', { mode: 'invalid' })).status, 400);
  assert.equal((await call('/settings', 'PUT', { mode: 'auto' })).status, 400);
  assert.equal((await call('/settings', 'PUT', { mode: 'manual' })).status, 200);
  assert.equal((await call('/settings', 'PUT', { downloadRoute: 'evil' })).status, 400);
  assert.equal(
    (await call('/settings', 'PUT', { downloadRoute: 'mirror', url: 'https://evil.test' })).status,
    400,
  );
  assert.deepEqual(await (await call('/settings', 'PUT', { downloadRoute: 'mirror' })).json(), {
    mode: 'manual',
    downloadRoute: 'mirror',
  });
  assert.deepEqual(await (await call('/settings', 'PUT', { mode: 'manual' })).json(), {
    mode: 'manual',
    downloadRoute: 'mirror',
  });
  assert.equal((await call('/cancel', 'POST', { id: '../bad' })).status, 400);
  assert.equal((await call('/cancel', 'POST', { id: 'a'.repeat(36) })).status, 409);
  assert.equal(
    (await call('/cancel', 'POST', { id: 'a'.repeat(36) }, { 'x-trim-isadmin': 'false' })).status,
    403,
  );
  assert.equal(
    (await call('/cancel', 'POST', { id: 'a'.repeat(36) }, { 'x-deskicons-token': 'bad' })).status,
    403,
  );
  const status = await call('/status');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    supported: false,
    job: null,
    mode: 'manual',
    idle: true,
  });
  assert.equal((await call('/status', 'GET', null, { 'x-trim-isadmin': 'false' })).status, 403);
  assert.equal(
    (await call('/install', 'POST', { version: '0.3.5' }, { 'x-deskicons-token': 'bad' })).status,
    403,
  );
  assert.equal(
    (await call('/install', 'POST', { version: '0.3.5', url: 'https://evil.test' })).status,
    400,
  );
  assert.equal((await call('/install', 'POST', { version: '../../evil' })).status, 400);
});
