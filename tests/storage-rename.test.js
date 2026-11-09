import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  realpath,
  rm,
  link,
  mkdir,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import { StorageService } from '../server/storage/service.js';
import { BatchRenameService, renameName } from '../server/storage/rename.js';
async function fixture() {
  const dir = await realpath(await mkdtemp(os.tmpdir() + '/rename-tools-'));
  await writeFile(dir + '/a.txt', 'one');
  await writeFile(dir + '/b.txt', 'two');
  const storage = new StorageService({ roots: [dir] }),
    rename = await new BatchRenameService({ dataDir: dir + '/state', storage }).init();
  return {
    dir,
    storage,
    rename,
    async close() {
      await rename.close();
      await storage.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('literal replacement, prefix suffix and numbering keep extensions and reject unsafe names', () => {
  assert.equal(
    renameName(
      'photo.old.jpg',
      { find: 'old', replace: 'new', prefix: 'P-', suffix: '-ok', number: true, start: 3, pad: 3 },
      1,
    ),
    'P-004_photo.new-ok.jpg',
  );
  assert.throws(() => renameName('a.txt', { prefix: '../' }, 0));
});
test('preview is read only, detects duplicate and existing targets, and belongs to its owner', async () => {
  const f = await fixture();
  try {
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt', 'b.txt'],
      rules: { prefix: 'new-' },
    });
    assert.equal(p.conflicts, 0);
    assert.deepEqual(
      (await readdir(f.dir)).filter((n) => n.endsWith('.txt')),
      ['a.txt', 'b.txt'],
    );
    await assert.rejects(f.rename.execute('b', p.id, { confirmed: true }), { status: 404 });
    await writeFile(f.dir + '/new-a.txt', 'existing');
    const clash = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt'],
      rules: { prefix: 'new-' },
    });
    assert.equal(clash.conflicts, 1);
    await assert.rejects(f.rename.execute('a', clash.id, { confirmed: true }));
  } finally {
    await f.close();
  }
});
test('execution requires confirmation, does not overwrite and is recoverable after service reload', async () => {
  const f = await fixture();
  try {
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt', 'b.txt'],
      rules: { prefix: 'new-' },
    });
    await assert.rejects(f.rename.execute('a', p.id, {}));
    const result = await f.rename.execute('a', p.id, { confirmed: true });
    assert.equal(result.status, 'completed');
    assert.equal(result.changed, 2);
    assert.equal(await readFile(f.dir + '/new-a.txt', 'utf8'), 'one');
    const loaded = await new BatchRenameService({
      dataDir: f.dir + '/state',
      storage: f.storage,
    }).init();
    try {
      const undone = await loaded.undo('a', result.id, { confirmed: true });
      assert.equal(undone.changed, 2);
      assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
      assert.equal(await readFile(f.dir + '/b.txt', 'utf8'), 'two');
    } finally {
      await loaded.close();
    }
  } finally {
    await f.close();
  }
});
test('changed source or new destination after preview rejects entire batch before renaming', async () => {
  const f = await fixture();
  try {
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt', 'b.txt'],
      rules: { prefix: 'new-' },
    });
    await writeFile(f.dir + '/b.txt', 'changed');
    await assert.rejects(f.rename.execute('a', p.id, { confirmed: true }), /变化/);
    assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
    const q = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt'],
      rules: { prefix: 'new-' },
    });
    await writeFile(f.dir + '/new-a.txt', 'keep');
    await assert.rejects(f.rename.execute('a', q.id, { confirmed: true }));
    assert.equal(await readFile(f.dir + '/new-a.txt', 'utf8'), 'keep');
  } finally {
    await f.close();
  }
});
test('partial undo can resume after reload', async () => {
  const f = await fixture();
  let loaded;
  try {
    const p = await f.rename.preview('a', {
        path: f.dir,
        names: ['a.txt', 'b.txt'],
        rules: { prefix: 'new-' },
      }),
      r = await f.rename.execute('a', p.id, { confirmed: true }),
      run = f.rename.run.bind(f.rename);
    f.rename.run = async (h, payload) => {
      await run(h, { ...payload, entries: payload.entries.slice(0, 1) });
      throw Error('interrupted');
    };
    assert.equal((await f.rename.undo('a', r.id, { confirmed: true })).status, 'partial');
    loaded = await new BatchRenameService({ dataDir: f.dir + '/state', storage: f.storage }).init();
    assert.equal((await loaded.undo('a', r.id, { confirmed: true })).status, 'completed');
    assert.equal(await readFile(f.dir + '/b.txt', 'utf8'), 'two');
  } finally {
    await loaded?.close();
    await f.close();
  }
});
test('shutdown waits for pending apply and prevents spawning after close', async () => {
  const f = await fixture();
  try {
    const p = await f.rename.preview('a', {
        path: f.dir,
        names: ['a.txt'],
        rules: { prefix: 'new-' },
      }),
      folder = f.rename.folder.bind(f.rename);
    let release, entered;
    const ready = new Promise((r) => (entered = r)),
      gate = new Promise((r) => (release = r));
    f.rename.folder = async (target) => {
      entered();
      await gate;
      return folder(target);
    };
    const execution = f.rename.execute('a', p.id, { confirmed: true });
    await ready;
    let ended = false;
    const close = f.rename.close().then(() => (ended = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(ended, false);
    release();
    await assert.rejects(execution, /关闭/);
    await close;
    assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
  } finally {
    await f.close();
  }
});

test('selected hardlink aliases are rejected before mutation', async () => {
  const f = await fixture();
  try {
    await link(f.dir + '/a.txt', f.dir + '/alias.txt');
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt', 'alias.txt'],
      rules: { prefix: 'new-' },
    });
    assert.equal(p.conflicts, 1);
    await assert.rejects(f.rename.execute('a', p.id, { confirmed: true }));
    assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
  } finally {
    await f.close();
  }
});
test('interrupted journal can recover actual changes and undo after restart', async () => {
  const f = await fixture();
  let loaded;
  try {
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt', 'b.txt'],
      rules: { prefix: 'new-' },
    });
    await f.rename.execute('a', p.id, { confirmed: true });
    const r = f.rename.records[0];
    r.status = 'running';
    r.changed = 0;
    r.progress.files = 0;
    for (const e of r.entries) {
      delete e.applied;
      delete e.after;
    }
    await f.rename.save();
    loaded = await new BatchRenameService({ dataDir: f.dir + '/state', storage: f.storage }).init();
    assert.equal(loaded.get('a', r.id).status, 'interrupted');
    assert.equal((await loaded.undo('a', r.id, { confirmed: true })).changed, 2);
    assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
  } finally {
    await loaded?.close();
    await f.close();
  }
});
test('unified names use a required base name, sequence and original extensions', () => {
  assert.equal(
    renameName('old.jpg', { mode: 'unified', baseName: '照片', start: 1, pad: 3 }, 1),
    '照片_002.jpg',
  );
  assert.equal(
    renameName(
      'old.tar.gz',
      { mode: 'unified', baseName: '归档', start: 5, pad: 2, keepExtension: false },
      0,
    ),
    '归档_05',
  );
  assert.throws(() => renameName('old.txt', { mode: 'unified', baseName: '' }));
  assert.throws(() => renameName('old.txt', { mode: 'unified', baseName: '../x' }));
});
test('unified preview and execution preserve file contents and can be undone', async () => {
  const f = await fixture();
  try {
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt', 'b.txt'],
      rules: { mode: 'unified', baseName: '资料', start: 3, pad: 2 },
    });
    assert.deepEqual(
      p.entries.map((e) => e.to),
      ['资料_03.txt', '资料_04.txt'],
    );
    const result = await f.rename.execute('a', p.id, { confirmed: true });
    assert.equal(result.changed, 2);
    assert.equal(await readFile(f.dir + '/资料_03.txt', 'utf8'), 'one');
    await f.rename.undo('a', result.id, { confirmed: true });
    assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
  } finally {
    await f.close();
  }
});

test('organizer exposes child directories, enters nested files and bounds parent navigation', async () => {
  const f = await fixture();
  try {
    await mkdir(f.dir + '/nested');
    await writeFile(f.dir + '/nested/child.txt', 'child');
    await symlink(f.dir + '/nested', f.dir + '/shortcut');
    const root = await f.rename.files(f.dir);
    assert.equal(root.parent, null);
    assert.equal(root.items[0].type, 'directory');
    assert.ok(root.items.some((r) => r.name === 'nested' && r.type === 'directory'));
    assert.ok(!root.items.some((r) => r.name === 'shortcut'));
    const child = await f.rename.files(f.dir + '/nested');
    assert.equal(child.parent, f.dir);
    assert.deepEqual(
      child.items.map((r) => [r.name, r.type]),
      [['child.txt', 'file']],
    );
    const preview = await f.rename.preview('a', {
      path: child.path,
      names: ['child.txt'],
      rules: { prefix: 'new-' },
    });
    assert.equal((await f.rename.execute('a', preview.id, { confirmed: true })).changed, 1);
    assert.equal(await readFile(f.dir + '/nested/new-child.txt', 'utf8'), 'child');
  } finally {
    await f.close();
  }
});

test('rename restart loads summaries only, keeps interrupted details intact and hydrates only requested batches', async () => {
  const f = await fixture();
  let loaded;
  try {
    const p = await f.rename.preview('a', {
      path: f.dir,
      names: ['a.txt'],
      rules: { prefix: 'new-' },
    });
    const done = await f.rename.execute('a', p.id, { confirmed: true });
    const persisted = f.rename.records.find((r) => r.id === done.id);
    persisted.status = 'running';
    await f.rename.save(persisted);
    f.rename.repository.save({
      id: 'unrequested',
      owner: 'a',
      mode: 'rename',
      operation: 'rename',
      path: f.dir,
      status: 'completed',
      entries: Array.from({ length: 500 }, (_, i) => ({
        from: 'old-' + i,
        to: 'new-' + i,
        unchanged: false,
      })),
    });
    loaded = new BatchRenameService({ dataDir: f.dir + '/state', storage: f.storage });
    const connection = loaded.repository.database.connection,
      prepare = connection.prepare.bind(connection);
    let detailQueries = 0;
    connection.prepare = (sql) => {
      if (/SELECT .* FROM rename_items/i.test(sql)) detailQueries++;
      return prepare(sql);
    };
    await loaded.init();
    assert.equal(detailQueries, 0, 'startup must not select any rename_items');
    assert.equal(loaded.records[0].status, 'interrupted');
    assert.equal('entries' in loaded.records[0], false);
    assert.ok(loaded.list('a').some((r) => r.id === done.id));
    assert.equal(detailQueries, 0, 'summary lists must stay lazy');
    const count = prepare('SELECT COUNT(*) n FROM rename_items WHERE batch_id=?').get(done.id).n;
    assert.equal(count, 1, 'metadata recovery must preserve saved detail rows');
    assert.equal(loaded.get('a', done.id).entries.length, 1);
    assert.equal(detailQueries, 1);
    loaded.get('a', done.id);
    assert.equal(detailQueries, 1, 'requested details should be cached');
    assert.equal((await loaded.undo('a', done.id, { confirmed: true })).changed, 1);
    assert.equal(await readFile(f.dir + '/a.txt', 'utf8'), 'one');
    assert.equal(
      'entries' in loaded.records.find((r) => r.id === 'unrequested'),
      false,
      'unrelated large batches must remain unhydrated through undo',
    );
  } finally {
    await loaded?.close();
    await f.close();
  }
});
