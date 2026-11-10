import {legacyNotificationSchema} from './fixtures/notification-schema.js';
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
import {
  schema,
  reachabilitySchema,
  operationSchema,
  notificationSchema,
} from '../server/persistence/schema.js';

test('schema14 upgrade preserves task history and creates empty notification queue with constrained settings', () => {
  const dir = mkdtempSync(tmpdir() + '/notifications-migration-');
  let db;
  try {
    const raw = new DatabaseSync(dir + '/nas-manager.sqlite');
    raw.exec(
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
        .replace(notificationSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(15[^;]*;/, '')
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
        .replace('PRAGMA user_version=30;', 'PRAGMA user_version=14;'),
    );
    raw.exec(
      `INSERT INTO tasks(id,name,type,enabled,schedule,options,timeout,pending_reason) VALUES('keep','Keep','script',0,'{}','{}',30,'Keep review');`,
    );
    raw.close();
    db = new DatabaseService(dir);
    assert.equal(db.connection.prepare('pragma user_version').get().user_version, 35);
    assert.equal(
      db.connection.prepare('select pending_reason from tasks where id=?').get('keep')
        .pending_reason,
      'Keep review',
    );
    assert.equal(db.connection.prepare('select count(*) n from notification_templates').get().n, 0);
    assert.equal(
      db.connection.prepare('select count(*) n from notification_deliveries').get().n,
      0,
    );
    assert.equal(db.connection.prepare('pragma integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.connection.prepare('pragma foreign_key_check').all(), []);
    db.close();
    db = new DatabaseService(dir);
    assert.equal(
      db.connection.prepare('select count(*) n from schema_migrations where version=15').get().n,
      1,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
