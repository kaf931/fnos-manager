import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-scan-repo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { ScanRepository } = await import('../server/persistence/scan.repository.js');
  const { RenameRepository } = await import('../server/persistence/rename.repository.js');
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  return { dir, db, repo: new ScanRepository(db), rename: new RenameRepository(db) };
}
const scan = {
  id: 'scan',
  owner: '1000',
  mode: 'space',
  path: '/vol1/data',
  status: 'completed',
  startedAt: '2026-10-20T00:00:00.000Z',
  finishedAt: '2026-10-20T00:00:01.000Z',
  error: null,
  progress: { files: 12 },
  result: {
    files: 12,
    catalog: Array.from({ length: 12 }, (_, i) => ({
      name: `f${i}`,
      path: `/vol1/data/f${i}`,
      size: 10,
      mtime: 100,
    })),
    largestFiles: [],
    entries: [],
    extensions: [],
    groups: [],
  },
};
test('scan records and result pages are owner scoped with deterministic sorting', async (t) => {
  const { repo } = await fixture(t);
  await repo.save(scan);
  assert.equal(repo.find('1001', 'scan'), undefined);
  const first = repo.entries('1000', 'scan', {
    page: 1,
    pageSize: 5,
    sort: 'size',
    direction: 'desc',
  });
  const second = repo.entries('1000', 'scan', {
    page: 2,
    pageSize: 5,
    sort: 'size',
    direction: 'desc',
  });
  assert.equal(first.total, 12);
  assert.equal(new Set([...first.items, ...second.items].map((x) => x.path)).size, 10);
  assert.throws(() =>
    repo.entries('1000', 'scan', {
      page: 1,
      pageSize: 5,
      sort: 'size; DROP TABLE scans',
      direction: 'desc',
    }),
  );
  assert.deepEqual(repo.find('1000', 'scan'), scan);
});
test('deleting scan and rename history removes detail rows but never actual files', async (t) => {
  const { repo, rename, db, dir } = await fixture(t);
  await repo.save(scan);
  const file = path.join(dir, 'user-file');
  await writeFile(file, 'keep');
  rename.save({
    id: 'batch',
    owner: '1000',
    mode: 'rename',
    path: dir,
    operation: 'rename',
    status: 'completed',
    entries: [{ from: 'before', to: 'user-file', applied: true, before: { size: '4' } }],
    changed: 1,
  });
  assert.equal(rename.find('1001', 'batch'), undefined);
  repo.remove('1001', ['scan']);
  assert.ok(repo.find('1000', 'scan'));
  repo.remove('1000', ['scan']);
  rename.remove('1000', ['batch']);
  assert.equal(db.connection.prepare('SELECT COUNT(*) n FROM scan_entries').get().n, 0);
  assert.equal(db.connection.prepare('SELECT COUNT(*) n FROM rename_items').get().n, 0);
  await access(file);
});
test('large result ingestion yields between batches and readers see a complete generation', async (t) => {
  const { repo } = await fixture(t);
  await repo.save(scan);
  let yielded = false;
  setImmediate(() => {
    yielded = true;
  });
  const many = {
    ...scan,
    result: {
      ...scan.result,
      catalog: Array.from({ length: 2300 }, (_, i) => ({
        name: `f${i}`,
        path: `/vol1/data/f${i}`,
        size: i,
        mtime: 100,
      })),
    },
  };
  const work = repo.save(many);
  assert.equal(
    repo.entries('1000', 'scan', { page: 1, pageSize: 5, sort: 'size', direction: 'desc' }).total,
    12,
  );
  await work;
  assert.equal(yielded, true);
  assert.equal(
    repo.entries('1000', 'scan', { page: 1, pageSize: 5, sort: 'size', direction: 'desc' }).total,
    2300,
  );
});
