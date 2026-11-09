import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('icon repository updates one record and rolls back invalid writes', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-icons-repo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { IconRepository } = await import('../server/persistence/icon.repository.js');
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const repo = new IconRepository(db);
  const entry = {
    id: 'icon1',
    name: 'a',
    url: 'http://nas/',
    mode: 'url',
    containerId: null,
    menuPage: null,
    iconSource: '自动获取',
    revision: 2,
    appliedRevision: 1,
    updatedAt: '2026-10-20T00:00:00.000Z',
  };
  repo.save(entry);
  repo.save({ ...entry, id: 'icon2', name: 'b' });
  assert.deepEqual(repo.find('icon1'), entry);
  assert.throws(() => repo.save({ ...entry, mode: 'bad' }));
  assert.deepEqual(repo.find('icon1'), entry);
  repo.save({ ...entry, name: 'c' });
  assert.equal(repo.list().length, 2);
  assert.equal(repo.find('icon2').name, 'b');
  repo.remove('icon1');
  assert.equal(repo.find('icon1'), undefined);
});

test('official repository stores explicit authorization fields without an old document key', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-official-repo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { OfficialRepository } = await import('../server/persistence/official.repository.js');
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const repo = new OfficialRepository(db);
  assert.equal(repo.get().connected, false);
  const state = {
    connected: true,
    origin: 'http://nas',
    fileStorage: true,
    pending: 12345,
    authorizationUrl: 'http://nas/oauth',
  };
  repo.save(state);
  assert.deepEqual(repo.get(), state);
  repo.save({ connected: false });
  assert.equal(repo.get().authorizationUrl, undefined);
  assert.equal(repo.get().connected, false);
});
