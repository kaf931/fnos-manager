import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appFixture } from './fixtures/terminal-app.js';
test('unsaved AI connection test reads models without persisting credentials and enforces CSRF and DTO', async (t) => {
  const requests = [];
  const mock = http.createServer((req, res) => {
    requests.push({ url: req.url, key: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => mock.close(r)));
  const f = await appFixture();
  t.after(f.close);
  const input = {
    protocol: 'openai',
    baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
    apiKey: 'test-secret',
  };
  const response = await f.call('/ai/test', 'POST', input);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { models: ['model-a', 'model-b'] });
  assert.deepEqual(requests, [{ url: '/v1/models', key: 'Bearer test-secret' }]);
  assert.deepEqual(await (await f.call('/ai/providers')).json(), []);
  assert.equal(
    (await f.call('/ai/test', 'POST', input, { 'x-deskicons-token': 'bad' })).status,
    403,
  );
  assert.equal((await f.call('/ai/test', 'POST', { ...input, protocol: 'unknown' })).status, 400);
  assert.equal(
    (await f.call('/ai/test', 'POST', { ...input, baseUrl: 'file:///etc/passwd' })).status,
    400,
  );
});
