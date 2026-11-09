import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StorageService } from '../server/storage/service.js';
import { BatchRenameService } from '../server/storage/rename.js';
for (const kind of ['scan', 'rename'])
  test(`${kind} history batch deletion checks ownership and running status before changing records`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'history-delete-'));
    try {
      const service =
        kind === 'scan'
          ? await new StorageService({ dataDir: dir }).init()
          : await new BatchRenameService({ dataDir: dir }).init();
      const items = [
        { id: 'own', owner: 'a', status: 'completed', entries: [], path: '/vol1/a' },
        { id: 'other', owner: 'b', status: 'completed', entries: [], path: '/vol1/b' },
        { id: 'active', owner: 'a', status: 'running', entries: [], path: '/vol1/a' },
      ];
      for (const item of items)
        if (kind === 'scan') {
          item.mode = 'space';
          item.result = null;
        } else item.operation = 'rename';
      if (kind === 'scan') for (const r of items) service.jobs.set(r.id, r);
      else service.records = items;
      await assert.rejects(service.deleteRecords('a', { ids: ['own', 'other'], confirmed: true }));
      assert.ok(service.get('a', 'own'));
      await assert.rejects(service.deleteRecords('a', { ids: ['own', 'active'], confirmed: true }));
      assert.ok(service.get('a', 'own'));
      await assert.rejects(service.deleteRecords('a', { ids: ['own'] }));
      assert.deepEqual(await service.deleteRecords('a', { ids: ['own', 'own'], confirmed: true }), {
        deleted: 1,
      });
      assert.throws(() => service.get('a', 'own'));
      assert.ok(service.get('b', 'other'));
      assert.ok(service.get('a', 'active'));
      const itemsInDatabase = service.repository.list();
      assert.equal(
        itemsInDatabase.some((r) => r.id === 'own'),
        false,
      );
      assert.equal(itemsInDatabase.length, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

test('deleting a space scan record preserves the scanned file and duplicate history', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'space-record-delete-'));
  let service;
  try {
    const file = path.join(dir, 'keep.txt');
    await writeFile(file, 'keep original content');
    service = await new StorageService({ dataDir: path.join(dir, 'state') }).init();
    for (const [id, mode] of [
      ['space', 'space'],
      ['duplicates', 'duplicates'],
    ])
      service.jobs.set(id, {
        id,
        mode,
        owner: 'a',
        status: 'completed',
        path: dir,
        result: { catalog: [{ path: file, size: 21 }] },
      });
    await service.deleteRecords('a', { ids: ['space'], confirmed: true });
    assert.equal(await readFile(file, 'utf8'), 'keep original content');
    assert.equal(service.get('a', 'duplicates').mode, 'duplicates');
    assert.throws(() => service.get('a', 'space'));
  } finally {
    await service?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan batch deletion rolls back every row when a later delete fails', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scan-delete-atomic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await new StorageService({ dataDir: dir }).init();
  for (const id of ['first', 'second'])
    service.jobs.set(id, {
      id,
      owner: 'a',
      mode: 'space',
      status: 'completed',
      path: '/vol1/a',
      result: null,
    });
  await service.persist();
  const db = service.repository.database.connection;
  db.exec(
    "CREATE TRIGGER fail_second_delete BEFORE DELETE ON scans WHEN OLD.id='second' BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  );
  await assert.rejects(
    () => service.deleteRecords('a', { ids: ['first', 'second'], confirmed: true }),
    /injected failure/,
  );
  assert.deepEqual(
    service.repository
      .list('a')
      .map((r) => r.id)
      .sort(),
    ['first', 'second'],
  );
  assert.deepEqual(
    service
      .list('a')
      .map((r) => r.id)
      .sort(),
    ['first', 'second'],
  );
  db.exec('DROP TRIGGER fail_second_delete');
  await service.close();
  db.close();
});

test('rename batch deletion rolls back every row and leaves memory unchanged when a later delete fails', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rename-delete-atomic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await new BatchRenameService({ dataDir: dir }).init();
  service.records = ['first', 'second'].map((id) => ({
    id,
    owner: 'a',
    operation: 'rename',
    status: 'completed',
    entries: [],
    path: '/vol1/a',
  }));
  await service.save();
  const db = service.repository.database.connection;
  db.exec(
    "CREATE TRIGGER fail_second_rename_delete BEFORE DELETE ON rename_batches WHEN OLD.id='second' BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  );
  await assert.rejects(
    () => service.deleteRecords('a', { ids: ['first', 'second'], confirmed: true }),
    /injected failure/,
  );
  assert.deepEqual(
    service.repository
      .list('a')
      .map((r) => r.id)
      .sort(),
    ['first', 'second'],
  );
  assert.deepEqual(
    service
      .list('a')
      .map((r) => r.id)
      .sort(),
    ['first', 'second'],
  );
  db.exec('DROP TRIGGER fail_second_rename_delete');
  await service.close();
  db.close();
});

test('restart preserves scan history up to its configured retention instead of a hardcoded cache limit', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scan-retention-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { ScanRepository } = await import('../server/persistence/scan.repository.js');
  const db = new DatabaseService(dir),
    repo = new ScanRepository(db);
  const { RetentionRepository } = await import('../server/persistence/retention.repository.js');
  const retention = new RetentionRepository(db);
  retention.save({ ...retention.limits(), scans: 300 });
  for (let i = 0; i < 205; i++)
    await repo.save({
      id: 'record-' + i,
      owner: 'a',
      mode: 'space',
      status: 'completed',
      path: '/vol1/a',
      result: null,
    });
  const service = await new StorageService({ dataDir: dir, database: db }).init();
  assert.equal(repo.list('a').length, 205);
  assert.equal(service.list('a').length, 205);
  await service.close();
  db.close();
});
for (const kind of ['scan', 'rename'])
  test(`${kind} deletion rechecks new file operations after waiting for persistence`, async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'delete-operation-race-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const service =
      kind === 'scan'
        ? await new StorageService({ dataDir: dir }).init()
        : await new BatchRenameService({ dataDir: dir }).init();
    const item = {
      id: 'race',
      owner: 'a',
      mode: 'space',
      operation: 'rename',
      status: 'completed',
      path: '/vol1/a',
      result: null,
      entries: [],
    };
    if (kind === 'scan') {
      service.jobs.set(item.id, item);
      await service.persist();
    } else {
      service.records.push(item);
      await service.save();
    }
    let release;
    service.pending = new Promise((resolve) => (release = resolve));
    const deleting = service.deleteRecords('a', { ids: ['race'], confirmed: true });
    if (kind === 'scan') service.recordOperations.add('race');
    else service.locks.add(item.path);
    release();
    await assert.rejects(deleting, { status: 409 });
    assert.ok(service.repository.find('a', 'race'));
    if (kind === 'scan') service.recordOperations.clear();
    else service.locks.clear();
    await service.close();
    service.repository.database.close();
  });
test('rename recovery persists interrupted status for SQL history', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rename-recover-sql-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = await new BatchRenameService({ dataDir: dir }).init();
  seed.records.push({
    id: 'crashed',
    owner: 'a',
    operation: 'rename',
    status: 'running',
    path: '/vol1/a',
    entries: [],
  });
  await seed.save();
  const restored = await new BatchRenameService({ dataDir: dir }).init();
  assert.equal(
    restored.repository.historyPage('a', { page: 1, pageSize: 10 }).items[0].status,
    'interrupted',
  );
  await restored.close();
  seed.repository.database.close();
  restored.repository.database.close();
});
