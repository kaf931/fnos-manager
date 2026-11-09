import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

async function fixture(t, invalid = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-v1-upgrade-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'old.sqlite'),
    destination = path.join(dir, 'v2', 'nas-manager.sqlite');
  const db = new DatabaseSync(source);
  db.exec('PRAGMA user_version=1; CREATE TABLE documents(path TEXT PRIMARY KEY,metadata TEXT)');
  const tables = {
    icons: [
      {
        id: 'icon1',
        name: '图标',
        url: 'http://nas/',
        mode: 'url',
        revision: 2,
        appliedRevision: 1,
        updatedAt: '2026-10-20T00:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'task1',
        name: '任务',
        type: 'script',
        enabled: false,
        schedule: { kind: 'daily', time: '03:00' },
        timeout: 300,
        script: 'printf hello',
        nextRunAt: null,
      },
    ],
    task_runs: [
      {
        id: 'run1',
        taskId: invalid ? 'missing' : 'task1',
        taskName: '任务',
        trigger: 'manual',
        status: 'success',
        startedAt: '2026-10-20T00:00:00.000Z',
        stdout: 'hello',
        stderr: '',
        code: 0,
      },
    ],
    ssh_connections: [
      {
        id: 'ssh1',
        ownerUid: '1000',
        name: 'nas',
        kind: 'remote',
        host: 'nas',
        port: 22,
        username: 'user',
        authMethod: 'password',
        credentials: { method: 'password', password: 'plain-secret' },
        folderId: 'folder1',
      },
    ],
    ssh_workspace: [
      {
        id: 'folder1',
        ownerUid: '1000',
        kind: 'folder',
        scope: 'assets',
        name: '分类',
        parentId: null,
      },
      {
        id: 'cmd1',
        ownerUid: '1000',
        kind: 'command',
        scope: 'commands',
        name: '时间',
        content: 'date',
        parentId: null,
      },
    ],
    ssh_known_hosts: [
      {
        ownerUid: '1000',
        host: 'nas',
        port: 22,
        algorithm: 'ed25519',
        key: 'public',
        fingerprint: 'SHA256:key',
      },
    ],
    wake_devices: [
      {
        id: 'wake1',
        owner: '1000',
        name: 'pc',
        mac: 'AA:BB:CC:DD:EE:FF',
        address: '192.168.1.255',
        port: 9,
        system: 'linux',
        connectionId: 'ssh1',
      },
    ],
    scan_history: [
      {
        id: 'scan1',
        owner: '1000',
        mode: 'duplicates',
        path: '/vol1/data',
        status: 'done',
        startedAt: '2026-10-20T00:00:00.000Z',
        progress: { files: 2 },
        result: {
          files: 2,
          catalog: [{ name: 'a', path: '/vol1/data/a', size: 12, mtime: 1 }],
          largestFiles: [],
          entries: [],
          extensions: [],
          groups: [
            { size: 12, count: 2, paths: ['/vol1/data/a', '/vol1/data/b'], pathsTruncated: false },
          ],
        },
      },
    ],
    rename_history: [
      {
        id: 'rename1',
        owner: '1000',
        path: '/vol1/data',
        operation: 'rename',
        status: 'success',
        entries: [{ from: 'a', to: 'b', before: { size: '12' } }],
        changed: 1,
      },
    ],
  };
  for (const [table, items] of Object.entries(tables)) {
    db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,owner TEXT,position INTEGER,payload TEXT)`);
    items.forEach((item, i) =>
      db
        .prepare(`INSERT INTO ${table} VALUES(?,?,?,?)`)
        .run(item.id || `host${i}`, item.ownerUid || item.owner || '', i, JSON.stringify(item)),
    );
  }
  db.prepare('INSERT INTO documents VALUES(?,?)').run(
    'official/connection.json',
    JSON.stringify({ connected: true, origin: 'http://nas', fileStorage: false }),
  );
  db.close();
  return { source, destination, tables };
}

test('isolated upgrade preserves identifiers, plain credentials and relational detail rows', async (t) => {
  const f = await fixture(t),
    before = await readFile(f.source);
  const { upgradeDatabase } = await import('../server/upgrade/v1-to-v2.js');
  const report = await upgradeDatabase(f.source, f.destination);
  assert.equal(report.targetVersion, 5);
  assert.deepEqual(await readFile(f.source), before);
  const db = new DatabaseSync(f.destination);
  t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('SELECT id FROM icons').get().id, 'icon1');
  assert.deepEqual(
    JSON.parse(db.prepare('SELECT credentials FROM ssh_connections').get().credentials),
    { method: 'password', password: 'plain-secret' },
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM duplicate_members').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rename_items').get().n, 1);
  assert.equal(db.prepare('SELECT connected FROM official_connection').get().connected, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='documents'").get().n,
    0,
  );
  await assert.rejects(() => upgradeDatabase(f.source, f.destination), /存在|exist/);
});

test('invalid reference aborts conversion without publishing a target or modifying source', async (t) => {
  const f = await fixture(t, true),
    before = await readFile(f.source);
  const { upgradeDatabase } = await import('../server/upgrade/v1-to-v2.js');
  await assert.rejects(() => upgradeDatabase(f.source, f.destination), /run1/);
  await assert.rejects(() => access(f.destination));
  assert.deepEqual(await readFile(f.source), before);
});
for (const shape of ['cycle', 'too-deep'])
  test('upgrade rejects invalid folder graph: ' + shape, async (t) => {
    const f = await fixture(t),
      db = new DatabaseSync(f.source);
    const folders =
      shape === 'cycle'
        ? [
            { id: 'a', parentId: 'b' },
            { id: 'b', parentId: 'a' },
          ]
        : Array.from({ length: 17 }, (_, i) => ({
            id: 'folder-' + i,
            parentId: i ? 'folder-' + (i - 1) : null,
          }));
    for (const [i, f] of folders.entries())
      db.prepare('INSERT INTO ssh_workspace VALUES(?,?,?,?)').run(
        f.id,
        '1000',
        i + 10,
        JSON.stringify({ ...f, ownerUid: '1000', scope: 'assets', kind: 'folder', name: f.id }),
      );
    db.close();
    const before = await readFile(f.source),
      { upgradeDatabase } = await import('../server/upgrade/v1-to-v2.js');
    await assert.rejects(() => upgradeDatabase(f.source, f.destination), /目录|folder/);
    await assert.rejects(() => access(f.destination));
    assert.deepEqual(await readFile(f.source), before);
  });
