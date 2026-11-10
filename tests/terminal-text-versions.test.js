import { legacyNotificationReset } from './fixtures/notification-schema.js';
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { TextVersionService } from '../server/terminal/text-versions.js';
const scope = {
  owner: 'alice',
  connectionId: 'saved',
  host: 'nas',
  port: 22,
  username: 'root',
  fingerprint: 'SHA256:accepted',
  path: '/config',
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-versions-'));
  const db = new DatabaseService(dir);
  db.connection
    .prepare(
      "INSERT INTO ssh_connections(id,owner_uid,name,kind,host,port,username,position) VALUES('saved','alice','NAS','remote','nas',22,'root',0)",
    )
    .run();
  const service = new TextVersionService(db);
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db, service };
}
test('private checkpoints preserve raw BOM bytes, normalize paths and isolate all target identities', (t) => {
  const { dir, service } = fixture(t);
  const raw = Buffer.from([255, 254, 65, 0, 13, 0, 10, 0]);
  const captured = service.capture(scope, raw, 'utf16le');
  assert.equal(service.read(scope, captured.id).content, 'A\r\n');
  assert.equal(service.read(scope, captured.id).bom, true);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'editor-versions', captured.id)), raw);
  assert.equal(fs.statSync(path.join(dir, 'editor-versions')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, 'editor-versions', captured.id)).mode & 0o777, 0o600);
  for (const changed of [
    { owner: 'bob' },
    { connectionId: 'other' },
    { host: 'elsewhere' },
    { port: 23 },
    { username: 'other' },
    { fingerprint: 'SHA256:new' },
    { path: '/other' },
  ]) {
    assert.deepEqual(service.list({ ...scope, ...changed }), []);
    assert.throws(() => service.read({ ...scope, ...changed }, captured.id), /不存在/);
  }
  assert.equal(service.list({ ...scope, path: '/dir/../config' }).length, 1);
  service.remove(scope, captured.id);
  assert.deepEqual(service.list(scope), []);
  assert.equal(fs.existsSync(path.join(dir, 'editor-versions', captured.id)), false);
});
test('checkpoints deduplicate retry originals, prune oldest per-file and reconcile crash remnants', (t) => {
  const { dir, db, service } = fixture(t);
  const first = service.capture(scope, Buffer.from('old'), 'utf8');
  assert.equal(service.capture(scope, Buffer.from('old'), 'utf8').id, first.id);
  for (let i = 0; i < 11; i++) service.capture(scope, Buffer.from('new' + i), 'utf8');
  assert.equal(service.list(scope).length, 10);
  assert.equal(fs.existsSync(path.join(dir, 'editor-versions', first.id)), false);
  fs.writeFileSync(path.join(dir, 'editor-versions', 'orphan'), 'interrupted');
  const item = service.list(scope)[0];
  fs.unlinkSync(path.join(dir, 'editor-versions', item.id));
  const restarted = new TextVersionService(db);
  assert.equal(restarted.list(scope).length, 9);
  assert.equal(fs.existsSync(path.join(dir, 'editor-versions', 'orphan')), false);
  db.connection.prepare("DELETE FROM ssh_connections WHERE id='saved'").run();
  assert.deepEqual(restarted.list(scope), []);
  restarted.reconcile();
  assert.equal(fs.readdirSync(path.join(dir, 'editor-versions')).length, 0);
});
test('backup store rejects symlinks and corrupted bytes without following them', (t) => {
  const { dir, db, service } = fixture(t);
  const item = service.capture(scope, Buffer.from('safe'), 'utf8');
  fs.writeFileSync(path.join(dir, 'editor-versions', item.id), 'evil');
  assert.throws(() => service.read(scope, item.id), /版本/);
  assert.throws(() => service.capture(scope, Buffer.from('safe'), 'utf8'), /版本/);
  fs.unlinkSync(path.join(dir, 'editor-versions', item.id));
  fs.symlinkSync('/etc/passwd', path.join(dir, 'editor-versions', item.id));
  assert.throws(() => new TextVersionService(db), /版本/);
});
test('schema17 migration preserves connection records and adds private schema18 exactly once', (t) => {
  const { db, dir } = fixture(t);
  db.connection.exec(
    legacyNotificationReset +
      'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=17',
  );
  db.close();
  const migrated = new DatabaseService(dir);
  t.after(() => migrated.close());
  assert.equal(migrated.connection.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(migrated.connection.prepare('SELECT COUNT(*) n FROM ssh_connections').get().n, 1);
  assert.equal(migrated.connection.prepare('SELECT COUNT(*) n FROM text_file_versions').get().n, 0);
  assert.equal(
    migrated.connection.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=18').get()
      .n,
    1,
  );
});
test('owner and application quotas prune oldest eligible records while preserving the requested backup', (t) => {
  const { db, dir, service } = fixture(t);
  const seed = service.capture(scope, Buffer.from('seed'), 'utf8');
  const template = service.repository.all()[0];
  // Seed persisted rows through the real repository; each file scope differs to exercise aggregate limits.
  db.transaction(() => {
    for (let owner = 0; owner < 10; owner++) {
      db.connection
        .prepare(
          'INSERT INTO ssh_connections(id,owner_uid,name,kind,host,port,username,position) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run('conn' + owner, 'owner' + owner, 'NAS', 'remote', 'nas', 22, 'root', owner + 1);
      for (let i = 0; i < 100; i++) {
        const id = (owner * 100 + i + 1).toString(16).padStart(48, '0');
        fs.writeFileSync(path.join(dir, 'editor-versions', id), 'seed', { mode: 0o600 });
        service.repository.insert({
          ...template,
          id,
          owner: 'owner' + owner,
          connectionId: 'conn' + owner,
          identity: 'path' + i,
          createdAt: new Date(1 + owner * 100 + i).toISOString(),
        });
      }
    }
  });
  service.capture({ ...scope, path: '/application' }, Buffer.from('new'), 'utf8');
  assert.equal(service.repository.all().length, 1000);
  assert.equal(
    service.repository.all().some((row) => row.id === '1'.padStart(48, '0')),
    false,
  );
  const target = { ...scope, owner: 'owner9', connectionId: 'conn9', path: '/owner-new' };
  const requested = service.capture(target, Buffer.from('owner new'), 'utf8');
  assert.equal(service.repository.all().filter((row) => row.owner === 'owner9').length, 100);
  assert.equal(service.read(target, requested.id).content, 'owner new');
  assert.equal(
    service.repository.all().some((row) => row.id === seed.id),
    true,
  );
});
test('backwards wall clock cannot prune the checkpoint being captured', (t) => {
  const { db, service } = fixture(t);
  for (let i = 0; i < 10; i++) service.capture(scope, Buffer.from('old' + i), 'utf8');
  db.connection.prepare('UPDATE text_file_versions SET created_at=?').run(Date.now() + 60_000);
  const fresh = service.capture(scope, Buffer.from('must keep'), 'utf8');
  assert.equal(service.list(scope).length, 10);
  assert.equal(service.read(scope, fresh.id).content, 'must keep');
});
test('owner byte quota evicts the oldest checkpoint without dropping the requested one', (t) => {
  const { db, dir, service } = fixture(t);
  service.capture(scope, Buffer.from('seed'), 'utf8');
  const template = service.repository.all()[0];
  const data = Buffer.alloc(5 * 1024 * 1024, 'A');
  const digest = createHash('sha256').update(data).digest('hex');
  db.transaction(() => {
    for (let i = 0; i < 20; i++) {
      const id = (i + 1).toString(16).padStart(48, '0');
      fs.writeFileSync(path.join(dir, 'editor-versions', id), data, { mode: 0o600 });
      service.repository.insert({
        ...template,
        id,
        identity: 'path' + i,
        size: data.length,
        hash: digest,
        createdAt: new Date(i + 1).toISOString(),
      });
    }
  });
  const requested = service.capture({ ...scope, path: '/bytes' }, Buffer.from('new'), 'utf8');
  assert.ok(service.repository.all().reduce((sum, row) => sum + row.size, 0) <= 100 * 1024 * 1024);
  assert.equal(
    service.repository.all().some((row) => row.id === '1'.padStart(48, '0')),
    false,
  );
  assert.equal(service.read({ ...scope, path: '/bytes' }, requested.id).content, 'new');
});
