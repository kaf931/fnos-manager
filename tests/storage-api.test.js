import {
  TerminalService as NestTerminalService,
  StorageService as NestStorageService,
  TasksService as NestTasksService,
} from '../server/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import { createApplication } from '../server/index.js';
test('storage routes enforce owner and CSRF, expose only configured roots, and retain owned history', async () => {
  const dir = await realpath(await mkdtemp(os.tmpdir() + '/storage-api-'));
  await writeFile(dir + '/x.txt', 'hello');
  const app = await createApplication({
    dataDir: dir + '/data',
    gateway: true,
    storageRoots: [dir],
  });
  const server = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`,
    headers = {
      'x-trim-isadmin': 'true',
      'x-trim-userid': '1000',
      'content-type': 'application/json',
    },
    state = await (await fetch(base + '/state', { headers })).json();
  try {
    const roots = await (await fetch(base + '/storage/directories', { headers })).json();
    assert.equal(roots.items[0].path, dir);
    assert.equal(
      (
        await fetch(base + '/storage/scans', {
          method: 'POST',
          headers,
          body: JSON.stringify({ path: dir, mode: 'space' }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + '/storage/rename/previews', {
          method: 'POST',
          headers,
          body: JSON.stringify({ path: dir, names: ['x.txt'], rules: { prefix: 'n-' } }),
        })
      ).status,
      403,
    );
    headers['x-deskicons-token'] = state.csrfToken;
    assert.equal(
      (await fetch(base + '/storage/scans', { headers: { ...headers, 'x-trim-isadmin': 'false' } }))
        .status,
      403,
    );
    const response = await fetch(base + '/storage/scans', {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: dir, mode: 'space' }),
    });
    assert.equal(response.status, 202);
    const job = await response.json();
    assert.equal(
      (
        await fetch(base + '/storage/scans/' + job.id, {
          headers: { ...headers, 'x-trim-userid': '1001' },
        })
      ).status,
      404,
    );
    assert.deepEqual(
      await (
        await fetch(base + '/storage/scans', { headers: { ...headers, 'x-trim-userid': '1001' } })
      ).json(),
      [],
    );
    assert.equal((await fetch(base + '/storage/scans', { headers })).status, 200);
    assert.equal(
      (
        await fetch(base + '/storage/scans/' + job.id + '/cancel', {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      200,
    );
    const preview = await (
      await fetch(base + '/storage/rename/previews', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: dir, names: ['x.txt'], rules: { prefix: 'n-' } }),
      })
    ).json();
    assert.equal(preview.changed, 1);
    assert.equal(
      (
        await fetch(base + '/storage/rename/previews/' + preview.id + '/execute', {
          method: 'POST',
          headers: { ...headers, 'x-trim-userid': '1001' },
          body: '{"confirmed":true}',
        })
      ).status,
      404,
    );
    const changed = await (
      await fetch(base + '/storage/rename/previews/' + preview.id + '/execute', {
        method: 'POST',
        headers,
        body: '{"confirmed":true}',
      })
    ).json();
    assert.equal(changed.changed, 1);
    assert.equal(
      (
        await fetch(base + '/storage/rename/records/' + changed.id, {
          headers: { ...headers, 'x-trim-userid': '1001' },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + '/storage/rename/records/' + changed.id + '/undo', {
          method: 'POST',
          headers,
          body: '{"confirmed":true}',
        })
      ).status,
      200,
    );
  } finally {
    await app.get(NestStorageService).service.close();
    await app.get(NestTerminalService).service.close();
    await app.get(NestTasksService).engine.close();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
