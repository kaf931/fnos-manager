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
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../server/persistence/database.service.js';
import {
  schema,
  reachabilitySchema,
  operationSchema,
  notificationSchema,
  backupSchema,
} from '../server/persistence/schema.js';

for (const source of ['fresh', 'schema13']) {
  test(`${source} schema14 initialization preserves tasks and persists backup receipts on reopening`, (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'backup-schema-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    if (source === 'schema13') {
      const raw = new DatabaseSync(path.join(dir, 'nas-manager.sqlite'));
      try {
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
            .replace(backupSchema, '')
            .replace(/INSERT INTO schema_migrations VALUES\(14[^;]*;/, '')
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
        .replace('PRAGMA user_version=30;', 'PRAGMA user_version=13;'),
        );
        raw.exec(
          `INSERT INTO tasks(id,owner_uid,name,type,enabled,schedule,options,timeout)
           VALUES('keep-task','owner','Keep task','script',1,'{"type":"manual"}','{"command":"echo keep"}',30)`,
        );
        assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 13);
        assert.ok(
          !raw
            .prepare('PRAGMA table_info(tasks)')
            .all()
            .some((c) => c.name === 'pending_reason'),
        );
        assert.equal(
          raw.prepare("SELECT name FROM sqlite_master WHERE name='backup_receipts'").get(),
          undefined,
        );
      } finally {
        raw.close();
      }
    }
    let db = new DatabaseService(dir);
    try {
      assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 34);
      assert.equal(
        db.connection.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=14').get().n,
        1,
      );
      assert.equal(db.connection.prepare('SELECT COUNT(*) n FROM backup_receipts').get().n, 0);
      assert.ok(
        db.connection
          .prepare('PRAGMA table_info(tasks)')
          .all()
          .some((c) => c.name === 'pending_reason'),
      );
      if (source === 'schema13') {
        assert.deepEqual(
          {
            ...db.connection
              .prepare('SELECT name,enabled,schedule,options,pending_reason FROM tasks WHERE id=?')
              .get('keep-task'),
          },
          {
            name: 'Keep task',
            enabled: 1,
            schedule: '{"type":"manual"}',
            options: '{"command":"echo keep"}',
            pending_reason: null,
          },
        );
      }
      db.connection
        .prepare(
          'INSERT INTO backup_receipts(owner_uid,request_id,request_digest,package_digest,selection_digest,result,created_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run('owner', 'request', 'digest', 'a'.repeat(64), 'b'.repeat(64), '{"restored":1}', 1);
      db.close();
      db = new DatabaseService(dir);
      assert.equal(
        db.connection
          .prepare('SELECT result FROM backup_receipts WHERE owner_uid=? AND request_id=?')
          .get('owner', 'request').result,
        '{"restored":1}',
      );
      assert.equal(
        db.connection.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=14').get().n,
        1,
      );
      assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      db.close();
    }
  });
}
