import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { ScanRepository } from '../server/persistence/scan.repository.js';
import { RenameRepository } from '../server/persistence/rename.repository.js';
import { createApplication, StorageService } from '../server/index.js';
const timestamp = '2026-10-20T00:00:00.000Z';
const scan = (id, owner = 'a', mode = 'space') => ({
  id,
  owner,
  mode,
  status: 'completed',
  path: '/vol1',
  startedAt: timestamp,
  progress: { files: 1, bytes: 1 },
  result: { catalog: [{ path: '/vol1/file', name: 'file', size: 1 }], groups: [] },
});
const rename = (id, owner = 'a') => ({
  id,
  owner,
  mode: 'rename',
  operation: 'rename',
  status: 'completed',
  path: '/vol1',
  startedAt: timestamp,
  entries: [{ from: 'old', to: 'new', unchanged: false }],
  directoryIdentity: 'private',
});
test('SQL history pages are stable, owner scoped, mode filtered and contain no detail collections', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/history-pages-'),
    database = new DatabaseService(dir),
    scans = new ScanRepository(database),
    renames = new RenameRepository(database);
  t.after(async () => {
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  for (const item of [scan('b'), scan('a'), scan('c', 'a', 'duplicates'), scan('hidden', 'b')])
    await scans.save(item);
  for (const item of [rename('b'), rename('a'), rename('hidden', 'b')]) renames.save(item);
  const first = scans.historyPage('a', { page: 1, pageSize: 1, mode: 'space' }),
    second = scans.historyPage('a', { page: 2, pageSize: 1, mode: 'space' });
  assert.equal(first.total, 2);
  assert.deepEqual(
    first.items.map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(
    second.items.map((r) => r.id),
    ['b'],
  );
  assert.equal('result' in first.items[0], false);
  assert.deepEqual(
    scans.historyPage('a', { page: 1, pageSize: 10, mode: 'duplicates' }).items.map((r) => r.id),
    ['c'],
  );
  const records = renames.historyPage('a', { page: 1, pageSize: 1 });
  assert.equal(records.total, 2);
  assert.equal(records.items[0].id, 'a');
  assert.equal('entries' in records.items[0], false);
  assert.equal(scans.historyPage('a', { page: 9, pageSize: 10 }).items.length, 0);
  assert.throws(() => scans.historyPage('a', { page: 0, pageSize: 10 }));
  assert.throws(() => renames.historyPage('a', { page: 1, pageSize: 201 }));
  for (const [table, index] of [
    ['scans', 'scans_owner'],
    ['rename_batches', 'rename_batches_owner'],
  ]) {
    const plan = database.connection
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE owner_uid=? ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?`,
      )
      .all('a', 10, 0)
      .map((r) => r.detail)
      .join(' ');
    assert.match(plan, new RegExp(index));
    assert.doesNotMatch(plan, /TEMP B-TREE/);
  }
});
test('history API validates SQL pages while preserving dashboard arrays and owner privacy', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/history-page-api-'),
    app = await createApplication({ dataDir: dir, gateway: true }),
    server = await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const service = app.get(StorageService),
    base = `http://127.0.0.1:${server.address().port}/app/deskicons/api`,
    headers = { 'x-trim-isadmin': 'true', 'x-trim-userid': '1000' };
  for (const item of [scan('a', '1000'), scan('b', '1000', 'duplicates'), scan('hidden', '1001')]) {
    await service.service.repository.save(item);
    service.service.jobs.set(item.id, item);
  }
  for (const item of [rename('a', '1000'), rename('b', '1000'), rename('hidden', '1001')]) {
    service.rename.repository.save(item);
    service.rename.records.push(item);
  }
  const get = (route) => fetch(base + route, { headers });
  const page = await (await get('/storage/scans?page=1&pageSize=1&mode=space')).json();
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, 'a');
  assert.equal('owner' in page.items[0], false);
  assert.equal('result' in page.items[0], false);
  const renamed = await (await get('/storage/rename/records?page=2&pageSize=1')).json();
  assert.equal(renamed.total, 2);
  assert.equal(renamed.items[0].id, 'b');
  assert.equal('entries' in renamed.items[0], false);
  assert.equal('directoryIdentity' in renamed.items[0], false);
  assert.ok(Array.isArray(await (await get('/storage/scans')).json()));
  assert.ok(Array.isArray(await (await get('/storage/rename/records')).json()));
  for (const query of ['page=0', 'page=no', 'page=1&pageSize=201', 'page=1&mode=invalid'])
    assert.equal((await get('/storage/scans?' + query)).status, 400);
});
