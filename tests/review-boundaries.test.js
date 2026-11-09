import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createApplication } from '../server/index.js';
async function fixture(t) {
  const dir = await mkdtemp(os.tmpdir() + '/review-boundaries-');
  const app = await createApplication({ dataDir: dir, gateway: true });
  const server = await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons`;
  const headers = { 'x-trim-isadmin': 'true', 'x-trim-userid': '1000' };
  const state = await (await fetch(base + '/api/state', { headers })).json();
  return {
    base,
    headers: {
      ...headers,
      'content-type': 'application/json',
      'x-deskicons-token': state.csrfToken,
    },
  };
}
test('null API Key is rejected without changing saved credentials', async (t) => {
  const { base, headers } = await fixture(t);
  const provider = {
    name: 'test',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'test',
    apiKey: 'original',
  };
  const saved = await (
    await fetch(base + '/api/terminal/ai/providers', {
      method: 'POST',
      headers,
      body: JSON.stringify(provider),
    })
  ).json();
  const response = await fetch(base + '/api/terminal/ai/providers/' + saved.id, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...provider, apiKey: null }),
  });
  assert.equal(response.status, 400);
  const detail = await (
    await fetch(base + '/api/terminal/ai/providers/' + saved.id, { headers })
  ).json();
  assert.equal(detail.apiKey, 'original');
});
test('hashed assets cache privately while APIs, ordinary assets and denied requests remain no-store', async (t) => {
  const { base, headers } = await fixture(t);
  const name = `audit-${process.pid}-ABcd1234.js`,
    plain = `audit-${process.pid}.js`;
  await mkdir('dist/assets', { recursive: true });
  for (const file of [name, plain]) await writeFile('dist/assets/' + file, '/* cache fixture */');
  t.after(async () => {
    for (const file of [name, plain]) await rm('dist/assets/' + file, { force: true });
  });
  const asset = await fetch(base + '/assets/' + name, { headers });
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  const denied = await fetch(base + '/assets/' + name);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  for (const route of ['/api/state', '/assets/' + plain, '/assets/missing-ABcd1234.js']) {
    const res = await fetch(base + route, { headers });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('remote text endpoints enforce gateway, CSRF, DTO and owned session boundaries', async (t) => {
  const { base, headers } = await fixture(t);
  const url = base + '/api/terminal/sessions/missing/files/text';
  assert.equal((await fetch(url + '?path=/test.txt')).status, 403);
  const payload = {
    path: '/test.txt',
    content: 'hello',
    encoding: 'utf8',
    bom: false,
    revision: 'a'.repeat(64),
  };
  const noToken = { ...headers };
  delete noToken['x-deskicons-token'];
  assert.equal(
    (await fetch(url, { method: 'POST', headers: noToken, body: JSON.stringify(payload) })).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, content: null }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })).status,
    404,
  );
  assert.equal((await fetch(url + '?path=/test.txt', { headers })).status, 404);
});
test('checkpoint routes enforce gateway/CSRF/session and backup only accepts a boolean', async (t) => {
  const { base, headers } = await fixture(t);
  const url = base + '/api/terminal/sessions/missing/files/text';
  for (const suffix of [
    '/versions?path=/test.txt',
    '/versions/' + 'a'.repeat(48) + '?path=/test.txt',
  ]) {
    assert.equal((await fetch(url + suffix)).status, 403);
    assert.equal((await fetch(url + suffix, { headers })).status, 404);
  }
  const noToken = { ...headers };
  delete noToken['x-deskicons-token'];
  assert.equal(
    (
      await fetch(url + '/versions/' + 'a'.repeat(48) + '?path=/test.txt', {
        method: 'DELETE',
        headers: noToken,
      })
    ).status,
    403,
  );
  const payload = {
    path: '/test.txt',
    content: 'hello',
    encoding: 'utf8',
    bom: false,
    revision: 'a'.repeat(64),
  };
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, backup: 'false' }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, backup: false }),
      })
    ).status,
    404,
  );
});
test('null backup option is rejected instead of bypassing the boolean DTO', async (t) => {
  const { base, headers } = await fixture(t);
  const response = await fetch(base + '/api/terminal/sessions/missing/files/text', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      path: '/test',
      content: 'x',
      encoding: 'utf8',
      bom: false,
      revision: 'a'.repeat(64),
      backup: null,
    }),
  });
  assert.equal(response.status, 400);
});
