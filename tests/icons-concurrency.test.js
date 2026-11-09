import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IconsService } from '../server/app/icons/icons.service.js';
import { DatabaseService } from '../server/persistence/database.service.js';

test('editing an icon holds its operation lock while rendering, preventing deletion or lost revisions', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'icons-concurrency-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const service = await IconsService.create({ dataDir: dir, gateway: false, version: 'test' }, db);
  const original = await service.createEntry({ name: 'Original', url: 'http://nas/' });
  const image = service.image(original.id);
  let entered, release;
  const started = new Promise((r) => {
    entered = r;
  });
  const pending = new Promise((r) => {
    release = r;
  });
  // Pause the image-rendering boundary, while keeping real SQLite and service operations.
  service.renderEntryIcon = async () => {
    entered();
    await pending;
    return image;
  };
  const edit = service.updateEntry(original.id, {
    name: 'Edited',
    url: 'http://nas/',
    image: 'image',
  });
  await started;
  try {
    await assert.rejects(service.removeEntry(original.id), (e) => e.status === 409);
    await assert.rejects(
      service.updateEntry(original.id, { name: 'Concurrent', url: 'http://nas/' }),
      (e) => e.status === 409,
    );
  } finally {
    release();
    await edit;
  }
  const saved = (await service.listEntries())[0];
  assert.equal(saved.name, 'Edited');
  assert.equal(saved.revision, 2);
  await service.updateEntry(original.id, { name: 'Next', url: 'http://nas/' });
  assert.equal((await service.listEntries())[0].revision, 3);
  await service.removeEntry(original.id);
  assert.deepEqual(await service.listEntries(), []);
});
