import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiSettingsRepository } from '../server/persistence/ai.repository.js';
import { AiSettingsService } from '../server/terminal/ai/settings.js';
test('AI settings isolate owners, clear explicit blank key, and return saved key only to its owner', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-settings-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const service = new AiSettingsService(new AiSettingsRepository(db));
  assert.equal(service.read('1000').hasKey, false);
  service.save('1000', {
    baseUrl: 'http://localhost:11434/v1/',
    model: 'test',
    apiKey: 'secret-ai-key',
  });
  assert.deepEqual(service.read('1000'), {
    baseUrl: 'http://localhost:11434/v1',
    model: 'test',
    hasKey: true,
    apiKey: 'secret-ai-key',
  });
  assert.equal(service.read('1001').hasKey, false);
  service.save('1000', { baseUrl: 'https://example.test/v1', model: 'other', apiKey: '' });
  assert.equal(service.privateSettings('1000').apiKey, '');
  for (const url of ['file:///tmp/a', 'http://user:secret@host', 'https://host/?key=x'])
    assert.throws(() => service.save('1000', { baseUrl: url, model: 'test' }));
});
test('v2 to v4 migration preserves rows and is idempotent', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-upgrade-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  db.connection.exec(
    legacyNotificationReset + "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11; DROP TABLE ai_chat_attachments; DROP TABLE ai_chat_protocol; DROP TABLE ai_chat_proposals; DROP TABLE ai_chat_messages; DROP TABLE ai_chats; DROP TABLE ai_providers; DELETE FROM schema_migrations WHERE version>=4; ALTER TABLE icons DROP COLUMN menu_page; DELETE FROM schema_migrations WHERE version=8; DELETE FROM schema_migrations WHERE version>=9; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=2; INSERT INTO icons(id,name,url,mode)VALUES('keep','Keep','http://test','url')",
  );
  db.connection.exec(
    'ALTER TABLE user_preferences DROP COLUMN default_page; ALTER TABLE user_preferences DROP COLUMN navigation_motion',
  );
  db.close();
  db = new DatabaseService(dir);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 32);
  assert.equal(db.connection.prepare('SELECT id FROM icons').get().id, 'keep');
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.connection.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
  db = new DatabaseService(dir);
  assert.equal(
    db.connection.prepare('SELECT count(*) n FROM schema_migrations WHERE version=4').get().n,
    1,
  );
  db.close();
});
