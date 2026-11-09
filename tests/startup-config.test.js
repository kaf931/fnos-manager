import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApplication } from '../server/app/bootstrap.js';
test('invalid startup configuration is rejected before creating a database', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nas-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const change of [
    { storageLimits: { maxEntries: -1 } },
    { gateway: 'false' },
    { storageRoots: ['relative/path'] },
  ]) {
    const dataDir = path.join(root, 'not-created');
    let app;
    await assert.rejects(async () => {
      app = await createApplication({
        root,
        dataDir,
        gateway: true,
        startScheduler: false,
        csrfToken: 'test-token',
        version: '0.2.11',
        ...change,
      });
      await app.close();
    }, /配置/);
    await assert.rejects(() => access(path.join(dataDir, 'nas-manager.sqlite')), {
      code: 'ENOENT',
    });
  }
});
