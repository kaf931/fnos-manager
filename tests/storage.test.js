import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, link, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StorageService } from '../server/storage/service.js';
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'storage-tools-')));
  await mkdir(root + '/folder');
  await writeFile(root + '/a.txt', 'same');
  await writeFile(root + '/folder/b.txt', 'same');
  await writeFile(root + '/c.txt', 'diff');
  await symlink(root, root + '/loop');
  await link(root + '/a.txt', root + '/hard.txt');
  return {
    root,
    service: new StorageService({ roots: [root] }),
    async close() {
      await this.service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function done(s, id, owner = 'a') {
  for (let i = 0; i < 200; i++) {
    const job = s.get(owner, id);
    if (!['running', 'queued'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('scan did not complete');
}
test('space scan is read only, excludes links and counts hard-linked data once', async () => {
  const f = await fixture();
  try {
    const j = await f.service.start('a', { path: f.root, mode: 'space' }),
      result = await done(f.service, j.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.result.bytes, 12);
    assert.equal(result.result.files, 3);
    assert.equal(result.result.skippedLinks, 1);
    assert.equal(result.result.directories, 1);
    assert.equal(result.result.entries.find((e) => e.name === 'folder').bytes, 4);
    assert.throws(() => f.service.get('b', j.id), { status: 404 });
  } finally {
    await f.close();
  }
});
test('duplicates require entire matching content; same size and hard links are not duplicates', async () => {
  const f = await fixture();
  try {
    const j = await f.service.start('a', { path: f.root, mode: 'duplicates' }),
      result = await done(f.service, j.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.result.groups.length, 1);
    assert.equal(result.result.groups[0].paths.length, 2);
    assert.equal(result.result.reclaimable, 4);
  } finally {
    await f.close();
  }
});
test('roots and symlinks cannot escape the selected storage scope', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.start('a', { path: '/etc', mode: 'space' }));
    await assert.rejects(f.service.browse(f.root + '/loop'));
    await assert.rejects(f.service.start('a', { path: f.root, mode: 'bad' }));
  } finally {
    await f.close();
  }
});
test('cancel releases worker and another scan can start; entry limit reports incomplete result', async () => {
  const f = await fixture();
  try {
    const j = await f.service.start('a', { path: f.root, mode: 'space' });
    assert.throws(() => f.service.cancel('b', j.id), { status: 404 });
    f.service.cancel('a', j.id);
    assert.equal(f.service.get('a', j.id).status, 'cancelled');
    const limited = new StorageService({ roots: [f.root], limits: { maxEntries: 1 } });
    try {
      const next = await limited.start('a', { path: f.root, mode: 'space' }),
        result = await done(limited, next.id);
      assert.equal(result.status, 'limited');
      assert.match(result.error, /上限/);
    } finally {
      await limited.close();
    }
  } finally {
    await f.close();
  }
});
test('replacing selected root with a symlink before worker traversal never exposes outside data', async () => {
  const f = await fixture(),
    outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'storage-outside-')));
  try {
    await writeFile(outside + '/secret.txt', 'outside');
    const j = await f.service.start('a', { path: f.root, mode: 'space' });
    const { rename } = await import('node:fs/promises');
    await rename(f.root, f.root + '-original');
    await symlink(outside, f.root);
    const result = await done(f.service, j.id);
    assert.notEqual(result.status, 'completed');
    assert.equal(result.result, null);
    await rm(f.root);
    await rename(f.root + '-original', f.root);
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});
test('Linux mount paths decode escaped names and include same-device bind targets', async () => {
  const { parseMountPaths } = await import('../server/storage/access.js');
  const mounts = parseMountPaths(
    '28 1 0:1 / /vol1 rw - btrfs /dev/a rw\n29 28 0:1 /other /vol1/bind\\040dir rw - btrfs /dev/a rw\n',
  );
  assert.ok(mounts.has('/vol1/bind dir'));
});
test('scan catalogs include nested regular files, timestamps and bounded largest-file results', async () => {
  const f = await fixture();
  try {
    const job = await f.service.start('a', { path: f.root, mode: 'space' }),
      r = (await done(f.service, job.id)).result;
    assert.equal(r.catalog.length, 3);
    assert.ok(r.catalog.some((x) => x.path === f.root + '/folder/b.txt'));
    assert.ok(r.catalog.every((x) => Number.isFinite(x.modifiedAt)));
    assert.equal(r.largestFiles[0].size, 4);
    assert.equal(r.catalogTruncated, false);
  } finally {
    await f.close();
  }
});
test('scan history persists owned results and handles interrupted records after restart', async () => {
  const f = await fixture();
  let service, loaded;
  try {
    service = await new StorageService({ roots: [f.root], dataDir: f.root + '/state' }).init();
    const job = await service.start('a', { path: f.root + '/folder', mode: 'space' });
    await done(service, job.id);
    await service.close();
    loaded = await new StorageService({ roots: [f.root], dataDir: f.root + '/state' }).init();
    assert.equal(loaded.get('a', job.id).result.files, 1);
    assert.throws(() => loaded.get('b', job.id), { status: 404 });
    assert.ok(loaded.get('a', job.id).capacity.available >= 0);
  } finally {
    await loaded?.close();
    await service?.close();
    await f.close();
  }
});
test('persisted running scan is restored as interrupted and never restarted', async () => {
  const f = await fixture();
  let loaded;
  try {
    const { DatabaseService } = await import('../server/persistence/database.service.js');
    const { ScanRepository } = await import('../server/persistence/scan.repository.js');
    const seed = new DatabaseService(f.root + '/state');
    await new ScanRepository(seed).save({
      id: 'paused',
      owner: 'a',
      mode: 'space',
      path: f.root,
      status: 'running',
      progress: { files: 1, bytes: 4 },
      result: null,
    });
    seed.close();
    loaded = await new StorageService({ roots: [f.root], dataDir: f.root + '/state' }).init();
    assert.equal(loaded.get('a', 'paused').status, 'interrupted');
    assert.equal(loaded.jobs.get('paused').worker, undefined);
  } finally {
    await loaded?.close();
    await f.close();
  }
});
test('shutdown while scan journal is pending prevents late worker spawn', async () => {
  const f = await fixture();
  let service;
  try {
    service = await new StorageService({ roots: [f.root] }).init();
    let release, entered;
    const ready = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r));
    const persist = service.persist.bind(service);
    let calls = 0;
    service.persist = async () => {
      if (++calls === 1) {
        entered();
        await gate;
      }
      return persist();
    };
    const scan = service.start('a', { path: f.root, mode: 'space' });
    await ready;
    const close = service.close();
    release();
    await assert.rejects(scan, /关闭/);
    await close;
    assert.equal(
      [...service.jobs.values()].some((j) => j.worker),
      false,
    );
  } finally {
    await service?.close();
    await f.close();
  }
});
test('concurrent starts reserve per-owner and global slots before capacity awaits', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled(
      ['a', 'a', 'b', 'c'].map((owner) => f.service.start(owner, { path: f.root, mode: 'space' })),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    const running = [...f.service.jobs.values()].filter((j) => j.status === 'running');
    assert.equal(running.length, 2);
    assert.equal(running.filter((j) => j.owner === 'a').length, 1);
  } finally {
    await f.close();
  }
});
test('cancelling a scan during journal save prevents its worker from starting', async () => {
  const f = await fixture();
  try {
    let release, entered;
    const ready = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r));
    let calls = 0;
    f.service.persist = async () => {
      if (++calls === 1) {
        entered();
        await gate;
      }
    };
    const start = f.service.start('a', { path: f.root, mode: 'space' });
    await ready;
    const id = [...f.service.jobs.keys()][0];
    f.service.cancel('a', id);
    release();
    const result = await start;
    assert.equal(result.status, 'cancelled');
    assert.equal(f.service.jobs.get(id).worker, undefined);
  } finally {
    await f.close();
  }
});
test('bounded file catalog reports truncation without changing totals or largest-file index', async () => {
  const f = await fixture(),
    s = new StorageService({ roots: [f.root], limits: { maxCatalogEntries: 2 } });
  try {
    const job = await s.start('a', { path: f.root, mode: 'space' }),
      r = (await done(s, job.id)).result;
    assert.equal(r.catalog.length, 2);
    assert.equal(r.catalogTruncated, true);
    assert.equal(r.files, 3);
    assert.equal(r.bytes, 12);
    assert.equal(r.largestFiles.length, 3);
  } finally {
    await s.close();
    await f.close();
  }
});
test('completed scan is visible only after its SQL results have committed', async () => {
  const f = await fixture();
  let release, service;
  try {
    service = await new StorageService({ roots: [f.root], dataDir: f.root + '/state' }).init();
    const save = service.repository.save.bind(service.repository);
    let entered;
    const ready = new Promise((resolve) => (entered = resolve)),
      gate = new Promise((resolve) => (release = resolve));
    service.repository.save = async (item) => {
      if (item.status === 'completed') {
        entered();
        await gate;
      }
      return save(item);
    };
    const job = await service.start('a', { path: f.root + '/folder', mode: 'space' });
    await ready;
    assert.equal(service.get('a', job.id).status, 'running');
    release();
    const result = await done(service, job.id);
    assert.equal(result.status, 'completed');
    assert.equal(
      service.repository.entries('a', job.id, {
        page: 1,
        pageSize: 10,
        sort: 'size',
        direction: 'desc',
      }).total,
      1,
    );
  } finally {
    release?.();
    await service?.close();
    await f.close();
  }
});
