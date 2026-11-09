import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, link, realpath } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { ScanRepository } from '../server/persistence/scan.repository.js';
import { createApplication, StorageService } from '../server/index.js';
import { StorageService as Scanner } from '../server/storage/service.js';
import { preferredDuplicateKeeper } from '../.web-test/storage-scan-model.js';

const file = (name, size) => ({ path: '/vol1/data/' + name, name, type: 'file', size });
const directory = (name, bytes) => ({ path: '/vol1/data/' + name, name, type: 'directory', bytes });
const scan = (id, catalog, options = {}) => ({
  id,
  owner: 'alice',
  path: '/vol1/data',
  mode: 'space',
  status: 'completed',
  startedAt: id === 'before' ? '2026-10-23T00:00:00.000Z' : '2026-10-24T00:00:00.000Z',
  progress: { files: catalog.length, bytes: 100 },
  result: {
    catalog,
    entries: [],
    groups: [],
    errors: 0,
    skippedLinks: 0,
    skippedMounts: 0,
    skippedHardLinks: 0,
    catalogTruncated: false,
    truncated: false,
    ...options.result,
  },
  ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'result')),
});
async function fixture(t) {
  const dir = await mkdtemp(os.tmpdir() + '/storage-comparison-');
  const database = new DatabaseService(dir),
    repository = new ScanRepository(database);
  t.after(async () => {
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { database, repository };
}
const query = { page: 1, pageSize: 20 };

test('stored scan comparison reports confirmed changes, deterministic bounded pages, filters and directory growth', async (t) => {
  const { repository } = await fixture(t);
  await repository.save(
    scan('before', [file('deleted', 5), file('changed', 20), file('same', 10)], {
      result: { entries: [directory('photos', 50)] },
    }),
  );
  await repository.save(
    scan('after', [file('added', 5), file('changed', 25), file('same', 10)], {
      path: '/vol1/./data/',
      result: { entries: [directory('photos', 60)] },
    }),
  );
  const result = repository.compare('alice', 'before', 'after', query);
  assert.deepEqual(result.counts, { added: 1, deleted: 1, directory: 1, size: 1 });
  assert.equal(result.total, 4);
  assert.equal(result.before.complete, true);
  assert.equal(result.after.complete, true);
  assert.equal(result.directoryComplete, true);
  assert.deepEqual(
    result.items.find((i) => i.kind === 'directory'),
    {
      path: '/vol1/data/photos',
      kind: 'directory',
      beforeSize: 50,
      afterSize: 60,
      delta: 10,
      uncertain: false,
    },
  );
  assert.equal(result.items.find((i) => i.kind === 'deleted').delta, -5);
  const pages = Array.from(
    { length: 4 },
    (_, i) => repository.compare('alice', 'before', 'after', { page: i + 1, pageSize: 1 }).items[0],
  );
  assert.deepEqual(pages, result.items);
  assert.equal(new Set(pages.map((i) => i.path)).size, 4);
  const filtered = repository.compare('alice', 'before', 'after', { ...query, kind: 'size' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].afterSize, 25);
  assert.equal(
    repository.compare('alice', 'before', 'after', { ...query, page: 20 }).items.length,
    0,
  );
});

test('incomplete current scan never converts a missing saved entry into a confirmed deletion', async (t) => {
  const { repository } = await fixture(t);
  await repository.save(
    scan('before', [file('missing', 100), file('changed', 10)], {
      result: { entries: [directory('photos', 30)] },
    }),
  );
  for (const result of [
    { catalogTruncated: true },
    { errors: 1 },
    { skippedLinks: 1 },
    { skippedMounts: 1 },
    { skippedHardLinks: 1 },
    { skippedHardLinks: undefined },
  ]) {
    await repository.save(
      scan('after', [file('changed', 20)], {
        result: { ...result, entries: [directory('photos', 40)] },
      }),
    );
    const comparison = repository.compare('alice', 'before', 'after', query);
    assert.equal(comparison.counts.deleted ?? 0, 0);
    const missing = comparison.items.find((i) => i.path.endsWith('/missing'));
    assert.equal(missing.kind, 'unconfirmed');
    assert.equal(missing.delta, null);
    assert.equal(missing.uncertain, true);
    assert.equal(comparison.items.find((i) => i.kind === 'size').delta, 10);
    assert.equal(comparison.after.complete, false);
  }
});

test('incomplete baseline cannot certify additions; truncated directory totals are visibly uncertain', async (t) => {
  const { repository } = await fixture(t);
  await repository.save(
    scan('before', [], {
      result: { catalogTruncated: true, truncated: true, entries: [directory('photos', 10)] },
    }),
  );
  await repository.save(
    scan('after', [file('newly-observed', 9)], {
      result: { entries: [directory('photos', 20), directory('new-directory', 20)] },
    }),
  );
  const result = repository.compare('alice', 'before', 'after', query);
  assert.equal(result.counts.added ?? 0, 0);
  assert.equal(result.items.find((i) => i.path.endsWith('newly-observed')).kind, 'unconfirmed');
  assert.equal(result.directoryComplete, false);
  assert.equal(result.items.find((i) => i.kind === 'directory').uncertain, true);
  assert.equal(
    result.items.some((i) => i.path.endsWith('new-directory')),
    false,
  );
});

test('comparison isolates both scan owners and rejects root/status/time/pagination errors', async (t) => {
  const { repository } = await fixture(t);
  await repository.save(scan('before', []));
  await repository.save(scan('after', []));
  assert.throws(() => repository.compare('bob', 'before', 'after', query), { status: 404 });
  await repository.save(scan('foreign', [], { owner: 'bob' }));
  assert.throws(() => repository.compare('alice', 'before', 'foreign', query), { status: 404 });
  assert.throws(() => repository.compare('alice', 'foreign', 'after', query), { status: 404 });
  for (const options of [
    { path: '/vol1/other' },
    { status: 'running' },
    { status: 'limited' },
    { status: 'failed' },
    { mode: 'duplicates' },
  ]) {
    await repository.save(scan('invalid', [], options));
    assert.throws(() => repository.compare('alice', 'before', 'invalid', query), { status: 400 });
  }
  assert.throws(() => repository.compare('alice', 'before', 'before', query), { status: 400 });
  assert.throws(() => repository.compare('alice', 'after', 'before', query), { status: 400 });
  for (const invalid of [
    { page: 0 },
    { page: 1.5 },
    { page: Number.MAX_SAFE_INTEGER },
    { pageSize: 201 },
    { pageSize: 0 },
    { kind: "'; DROP TABLE scans" },
  ])
    assert.throws(() => repository.compare('alice', 'before', 'after', { ...query, ...invalid }), {
      status: 400,
    });
  assert.equal(repository.list('alice').length, 3);
});

test('comparison HTTP validates queries and preserves storage owner isolation', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/storage-comparison-api-');
  const app = await createApplication({ dataDir: dir, gateway: true });
  const server = await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const repository = app.get(StorageService).service.repository;
  await repository.save(scan('before', [], { owner: '1000' }));
  await repository.save(scan('after', [file('added', 1)], { owner: '1000' }));
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons/api/storage/scans/after/comparison`;
  const headers = { 'x-trim-isadmin': 'true', 'x-trim-userid': '1000' };
  const response = await fetch(base + '?before=before', { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 1);
  assert.equal(body.items[0].kind, 'added');
  assert.equal('owner' in body.before, false);
  for (const suffix of [
    '',
    '?before=before&page=0',
    '?before=before&pageSize=201',
    '?before=before&kind=invalid',
  ])
    assert.equal((await fetch(base + suffix, { headers })).status, 400);
  assert.equal(
    (await fetch(base + '?before=before', { headers: { ...headers, 'x-trim-userid': '1001' } }))
      .status,
    404,
  );
  assert.equal(
    (await fetch(base + '?before=before', { headers: { ...headers, 'x-trim-isadmin': 'false' } }))
      .status,
    403,
  );
});

test('preferred keeper respects directory boundaries, normalization and deterministic fallback without mutating paths', () => {
  const paths = [
    '/backup-other/a',
    '/original/z',
    '/backup/child/z',
    '/backup/a',
    '/backup/child/a',
  ];
  const group = { size: 1, paths };
  assert.equal(preferredDuplicateKeeper(group, '/backup'), '/backup/a');
  assert.equal(preferredDuplicateKeeper(group, '/backup/./child/'), '/backup/child/a');
  assert.equal(preferredDuplicateKeeper(group, '/backup-other'), '/backup-other/a');
  assert.equal(preferredDuplicateKeeper(group, '/missing'), '/backup-other/a');
  assert.equal(preferredDuplicateKeeper(group, '/'), '/backup-other/a');
  assert.equal(
    preferredDuplicateKeeper({ ...group, paths: [...paths].reverse() }, '/backup'),
    '/backup/a',
  );
  assert.equal(
    preferredDuplicateKeeper({ size: 1, paths: ['/backup-other/a', '/original/z'] }, '/backup'),
    '/backup-other/a',
  );
  assert.equal(preferredDuplicateKeeper({ size: 1, paths: [] }, '/backup'), '');
  assert.deepEqual(group.paths, paths);
});

test('worker records hard-link coverage loss so later comparisons cannot infer deletion from deduplication', async (t) => {
  const dir = await realpath(await mkdtemp(os.tmpdir() + '/scan-link-coverage-'));
  const scanner = new Scanner({ roots: [dir] });
  t.after(async () => {
    await scanner.close();
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(dir + '/original', 'same');
  await link(dir + '/original', dir + '/copy');
  const scan = await scanner.start('alice', { mode: 'space', path: dir });
  let result;
  for (let i = 0; i < 200; i++) {
    result = scanner.get('alice', scan.id);
    if (!['running', 'queued'].includes(result.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(result.status, 'completed');
  assert.equal(result.result.files, 1);
  assert.equal(result.result.skippedHardLinks, 1);
  assert.equal(result.result.catalogTruncated, false);
});
