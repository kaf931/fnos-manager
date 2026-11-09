import test from 'node:test';
import assert from 'node:assert/strict';
import { appFixture } from './fixtures/terminal-app.js';
import { skillZip, skillDocument } from './fixtures/skill-zip.js';
test('ZIP API imports via protected raw upload and exposes owner scoped resources', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const zip = skillZip([
    ['SKILL.md', skillDocument],
    ['reference/info.md', 'Test resource'],
    ['assets/blob.bin', Buffer.from([0, 1, 2, 255])],
  ]);
  const upload = (headers) =>
    fetch(f.base + '/terminal/ai/skill-packages/upload', {
      method: 'POST',
      headers: { ...f.headers, 'content-type': 'application/zip', ...headers },
      body: zip,
    });
  assert.equal((await upload({ 'x-deskicons-token': 'bad' })).status, 403);
  const response = await upload({});
  assert.equal(response.status, 201);
  const preview = await response.json();
  assert.ok(preview.previewId);
  assert.equal(
    (
      await f.call(
        '/ai/skill-packages/commit',
        'POST',
        { previewId: preview.previewId },
        { 'x-trim-userid': '2000' },
      )
    ).status,
    404,
  );
  const saved = await f.call('/ai/skill-packages/commit', 'POST', { previewId: preview.previewId });
  assert.equal(saved.status, 201);
  const item = await saved.json();
  assert.equal(item.enabled, false);
  assert.equal(
    (await f.call('/ai/skills/' + item.id + '/resources', 'GET', null, { 'x-trim-userid': '2000' }))
      .status,
    404,
  );
  assert.equal(
    (await f.call('/ai/skills/' + item.id + '/enabled', 'PUT', { enabled: true })).status,
    200,
  );
  const resource = await f.call('/ai/skills/' + item.id + '/resource?path=reference%2Finfo.md');
  assert.equal(resource.status, 200);
  assert.equal((await resource.json()).text, 'Test resource');
  const binary = await f.call('/ai/skills/' + item.id + '/resource/file?path=assets%2Fblob.bin');
  assert.equal(binary.status, 200);
  assert.ok(binary.headers.get('content-disposition').startsWith('attachment;'));
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([0, 1, 2, 255]));
  assert.equal(
    (await f.call('/ai/skill-packages/preview', 'POST', { url: 'https://127.0.0.1/test.zip' }))
      .status,
    400,
  );
});
