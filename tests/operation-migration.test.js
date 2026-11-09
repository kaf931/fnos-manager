import { legacyNotificationSchema } from './fixtures/notification-schema.js';
import { appearanceSchema } from '../server/persistence/schema.js';
import { rdpSchema } from '../server/persistence/schema.js';
import { vncCursorSchema } from '../server/persistence/schema.js';
import { retentionSchema } from '../server/persistence/schema.js';
import { adbSchema, vncSchema, vncPreferencesSchema } from '../server/persistence/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../server/persistence/database.service.js';
import { schema, reachabilitySchema, operationSchema } from '../server/persistence/schema.js';
test('schema15 upgrade preserves notification settings and creates empty operation records', () => {
  const dir = mkdtempSync(tmpdir() + '/operation-migration-');
  let db;
  try {
    const old = new DatabaseSync(dir + '/nas-manager.sqlite');
    old.exec(
      legacyNotificationSchema(schema)
        .replace(
          /CREATE TABLE text_file_versions[\s\S]*?CREATE INDEX text_file_versions_scope[^;]*;/,
          '',
        )
        .replace(/INSERT INTO schema_migrations VALUES\(18[^;]*;/, '')
        .replace(reachabilitySchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(17[^;]*;/, '')
        .replace(operationSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(16[^;]*;/, '')
        .replace(retentionSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(21[^;]*;/, '')
        .replace(vncPreferencesSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(20[^;]*;/, '')
        .replace(adbSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(29[^;]*;/, '')
        .replace(/CREATE TABLE IF NOT EXISTS notification_options[\s\S]*?\) STRICT;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(30[^;]*;/, '')
        .replace(vncSchema, '')
        .replace(rdpSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(23[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(19[^;]*;/, '')
        .replace(vncCursorSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(22[^;]*;/, '')
        .replace(appearanceSchema, '')
        .replace(/CREATE TABLE update_settings[\s\S]*?\) STRICT;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(26[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(25[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(24[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(27[^;]*;/, '')
        .replace(/INSERT INTO schema_migrations VALUES\(28[^;]*;/, '')
        .replace('PRAGMA user_version=30;', 'PRAGMA user_version=15;'),
    );
    old.exec(
      "INSERT INTO notification_settings VALUES('owner',0,'http://localhost/hook','','errors',1,1)",
    );
    old.close();
    db = new DatabaseService(dir);
    assert.equal(db.connection.prepare('pragma user_version').get().user_version, 32);
    assert.equal(db.connection.prepare('select count(*) n from operation_records').get().n, 0);
    assert.equal(
      JSON.parse(db.connection.prepare('select config from notification_templates').get().config)
        .url,
      'http://localhost/hook',
    );
    assert.equal(db.connection.prepare('pragma integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.connection.prepare('pragma foreign_key_check').all(), []);
    db.close();
    db = new DatabaseService(dir);
    assert.equal(
      db.connection.prepare('select count(*) n from schema_migrations where version=16').get().n,
      1,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
