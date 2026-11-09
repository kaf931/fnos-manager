import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-schema-v2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const service = new DatabaseService(dir);
  t.after(() => service.close());
  return { dir, service, db: service.connection };
}

test('business schema enforces strict types, non-null ids and valid device ports', async (t) => {
  const { dir, db } = await fixture(t);
  const tables = db
    .prepare('PRAGMA table_list')
    .all()
    .filter((r) => !r.name.startsWith('sqlite_'));
  assert.ok(tables.some((r) => r.name === 'schema_migrations'));
  assert.ok(tables.every((r) => r.strict === 1));
  assert.ok(!tables.some((r) => r.name === 'documents'));
  assert.throws(() =>
    db
      .prepare('INSERT INTO icons(id,name,url,mode) VALUES(NULL,?,?,?)')
      .run('a', 'http://nas/', 'url'),
  );
  const add = db.prepare(
    'INSERT INTO wake_devices(id,owner_uid,name,mac,address,port,system) VALUES(?,?,?,?,?,?,?)',
  );
  assert.throws(() =>
    add.run('a', '1000', 'a', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 70000, 'linux'),
  );
  assert.throws(() =>
    add.run('a', '1000', 'a', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 'bad', 'linux'),
  );
  assert.equal((await stat(path.join(dir, 'nas-manager.sqlite'))).mode & 0o777, 0o600);
});

test('foreign keys prevent missing and cross-owner terminal bindings', async (t) => {
  const { db } = await fixture(t);
  db.prepare(
    'INSERT INTO ssh_connections(id,owner_uid,name,kind,host,port,username) VALUES(?,?,?,?,?,?,?)',
  ).run('ssh', '1000', 'nas', 'remote', 'nas', 22, 'user');
  const add = db.prepare(
    'INSERT INTO wake_devices(id,owner_uid,name,mac,address,port,system,connection_id) VALUES(?,?,?,?,?,?,?,?)',
  );
  assert.throws(() =>
    add.run('a', '1001', 'device', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 9, 'linux', 'ssh'),
  );
  assert.throws(() =>
    add.run('b', '1000', 'device', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 9, 'linux', 'missing'),
  );
  add.run('c', '1000', 'device', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 9, 'linux', 'ssh');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('transaction rolls back earlier statements on failure and rejects async callbacks', async (t) => {
  const { service, db } = await fixture(t);
  assert.throws(() =>
    service.transaction(() => {
      db.prepare('INSERT INTO icons(id,name,url,mode) VALUES(?,?,?,?)').run(
        'first',
        'a',
        'http://nas/',
        'url',
      );
      db.prepare('INSERT INTO icons(id,name,url,mode) VALUES(?,?,?,?)').run(
        'first',
        'b',
        'http://nas/',
        'url',
      );
    }),
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM icons').get().n, 0);
  assert.throws(() => service.transaction(async () => {}), /synchronous|同步/);
});

test('runtime rejects v1 and future databases without modifying them', async (t) => {
  for (const version of [1, 99]) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-version-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'nas-manager.sqlite');
    const original = new DatabaseSync(file);
    original.exec(
      `PRAGMA user_version=${version}; CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES('intact')`,
    );
    original.close();
    const { DatabaseService } = await import('../server/persistence/database.service.js');
    assert.throws(() => new DatabaseService(dir), /升级|版本/);
    const check = new DatabaseSync(file);
    assert.equal(check.prepare('SELECT value FROM keep').get().value, 'intact');
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, version);
    check.close();
  }
});
