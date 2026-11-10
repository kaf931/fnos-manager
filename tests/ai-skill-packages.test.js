import { legacyNotificationSchema } from './fixtures/notification-schema.js';
import { appearanceSchema } from '../server/persistence/schema.js';
import { rdpSchema } from '../server/persistence/schema.js';
import { vncCursorSchema } from '../server/persistence/schema.js';
import { retentionSchema } from '../server/persistence/schema.js';
import { vncSchema, vncPreferencesSchema } from '../server/persistence/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiSkillRepository } from '../server/persistence/ai-skill.repository.js';

test('package schema preserves document skills and rejects invalid owner/file references', () => {
  const dir = mkdtempSync(tmpdir() + '/skill-package-');
  const db = new DatabaseService(dir);
  try {
    const skills = new AiSkillRepository(db);
    const item = skills.save('owner', {
      document: '---\nname: example\ndescription: example\n---\nInstructions',
      enabled: false,
    });
    assert.equal(item.kind, 'document');
    assert.equal(item.revision, 1);
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
    assert.throws(() =>
      db.connection
        .prepare(
          'INSERT INTO ai_skill_package_files(package_id,path,size,sha256,text) VALUES(?,?,?,?,?)',
        )
        .run('missing', 'x', 1, 'a'.repeat(64), 1),
    );
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('schema11 migration preserves enabled document definitions and unrelated records', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const {
    schema,
    reachabilitySchema,
    operationSchema,
    notificationSchema,
    backupSchema,
    aiSkillPackagesSchema,
    aiArchiveAttachmentsSchema,
  } = await import('../server/persistence/schema.js');
  const dir = mkdtempSync(tmpdir() + '/skill-v11-');
  let raw = new DatabaseSync(dir + '/nas-manager.sqlite');
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
      .replace(aiArchiveAttachmentsSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(13[^;]*;/, '')
      .replace(aiSkillPackagesSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(12[^;]*;/, '')
      .replace(retentionSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(21[^;]*;/, '')
      .replace(vncPreferencesSchema, '')
      .replace(/INSERT INTO schema_migrations VALUES\(20[^;]*;/, '')
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
      .replace(/CREATE TABLE adb_connections[\s\S]*?CREATE INDEX adb_connections_owner[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(29[^;]*;/, '')
      .replace(/CREATE TABLE IF NOT EXISTS notification_options[\s\S]*?\) STRICT;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(30[^;]*;/, '')
      .replace('PRAGMA user_version=30', 'PRAGMA user_version=11'),
  );
  raw
    .prepare(
      'INSERT INTO ai_skills(id,owner_uid,name,description,instructions,enabled,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)',
    )
    .run('old', 'a', 'old-skill', 'existing', 'keep instructions', 1, 1, 1);
  raw.exec(
    "INSERT INTO icons(id,name,url,mode)VALUES('keep01','Keep','http://example.test','url')",
  );
  raw.close();
  const db = new DatabaseService(dir);
  try {
    const item = new AiSkillRepository(db).get('a', 'old');
    assert.equal(item.instructions, 'keep instructions');
    assert.equal(item.enabled, true);
    assert.equal(item.revision, 1);
    assert.equal(db.connection.prepare('SELECT name FROM icons').get().name, 'Keep');
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('native package includes the ZIP parser as a production dependency', async () => {
  const { createPackageConfig } = await import('../scripts/package-config.js');
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const config = createPackageConfig(pkg);
  assert.equal(config.runtime.dependencies.yauzl, '3.4.0');
});
