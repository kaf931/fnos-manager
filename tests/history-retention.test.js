import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { RetentionRepository } from '../server/persistence/retention.repository.js';
function fixture(t) {
  const dir = mkdtempSync(tmpdir() + '/retention-');
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, repo: new RetentionRepository(db) };
}
test('history limits persist, reject invalid inputs and use database constraints', (t) => {
  const { db, repo } = fixture(t);
  assert.equal(repo.limits().scans, 20);
  repo.save({ ...repo.limits(), scans: 2 });
  assert.equal(new RetentionRepository(db).limits().scans, 2);
  for (const value of [0, -1, 10001, 1.2, NaN, '2'])
    assert.throws(() => repo.save({ ...repo.limits(), scans: value }));
  assert.throws(() => repo.save({ ...repo.limits(), serviceLogMiB: 101 }));
  assert.throws(() => db.connection.exec('UPDATE history_limits SET scans=0'));
});
test('automatic trimming keeps newest terminal operations per owner and protects active work', (t) => {
  const { db, repo } = fixture(t),
    c = db.connection;
  for (const owner of ['a', 'b'])
    for (let i = 0; i < 4; i++)
      c.prepare("INSERT INTO operation_records VALUES(?,?, 'ssh.delete','file',?,?,?, '')").run(
        owner + i,
        owner,
        i === 0 ? 'running' : 'success',
        i,
        i === 0 ? null : i,
      );
  assert.equal(repo.trim('operations', 2).length, 2);
  assert.equal(
    c.prepare("SELECT count(*) n FROM operation_records WHERE owner_uid='a'").get().n,
    3,
  );
  assert.equal(repo.clear('operations', 'a').length, 2);
  assert.equal(
    c.prepare("SELECT count(*) n FROM operation_records WHERE owner_uid='b'").get().n,
    3,
  );
  assert.equal(
    c.prepare("SELECT status FROM operation_records WHERE id='a0'").get().status,
    'running',
  );
});
test('restore receipts stay protected for seven days including under quota pressure', (t) => {
  const { db, repo } = fixture(t),
    c = db.connection,
    now = Date.now();
  for (let i = 0; i < 5; i++)
    c.prepare('INSERT INTO backup_receipts VALUES(?,?,?,?,?,?,?)').run(
      'a',
      'r' + i,
      'd',
      'a'.repeat(64),
      'b'.repeat(64),
      '{}',
      i === 4 ? now : now - 8 * 86400000 + i,
    );
  assert.equal(repo.trim('restoreReceipts', 2).length, 3);
  assert.equal(repo.clear('restoreReceipts', 'a').length, 1);
  assert.equal(c.prepare('SELECT request_id FROM backup_receipts').get().request_id, 'r4');
  assert.equal(repo.count('restoreReceipts', 'a').protected, 1);
});
test('scan retention synchronizes persisted history, caches and cascade children while protecting active processing', async (t) => {
  const { db, repo } = fixture(t);
  const { StorageService } = await import('../server/storage/service.js');
  repo.save({ ...repo.limits(), scans: 2 });
  const scanner = await new StorageService({ dataDir: db.dataDir, database: db }).init();
  for (let i = 0; i < 5; i++) {
    const id = 'scan' + i;
    scanner.jobs.set(id, {
      id,
      owner: 'a',
      mode: 'space',
      path: '/vol1/a',
      status: 'completed',
      startedAt: new Date(i + 1).toISOString(),
      result: null,
    });
    if (i === 0) scanner.recordOperations.add(id);
    await scanner.persist(scanner.jobs.get(id));
  }
  assert.equal(scanner.jobs.size, 3);
  assert.equal(scanner.repository.list('a').length, 3);
  assert.ok(scanner.jobs.has('scan0'));
  scanner.recordOperations.clear();
  scanner.pruneHistory();
  assert.deepEqual([...scanner.jobs.keys()], ['scan3', 'scan4']);
  assert.equal(scanner.pruneHistory('a', true), 2);
  await scanner.persist();
  assert.equal(scanner.repository.list('a').length, 0);
  await scanner.close();
});
test('v20 migration preserves configuration and creates one empty retention table', (t) => {
  const { db } = fixture(t);
  const dir = db.dataDir;
  db.connection.exec(
    legacyNotificationReset + "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; INSERT INTO icons(id,name,url,mode) VALUES('keep','keep','http://localhost','url'); ALTER TABLE vnc_preferences DROP COLUMN cursor_mode; DROP TABLE rdp_connections; DELETE FROM schema_migrations WHERE version=23; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=20",
  );
  db.close();
  const migrated = new DatabaseService(dir);
  t.after(() => migrated.close());
  assert.equal(migrated.connection.prepare('PRAGMA user_version').get().user_version, 33);
  assert.equal(migrated.connection.prepare('SELECT name FROM icons').get().name, 'keep');
  assert.equal(
    migrated.connection.prepare('SELECT count(*) n FROM schema_migrations WHERE version=21').get()
      .n,
    1,
  );
  assert.equal(migrated.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});
