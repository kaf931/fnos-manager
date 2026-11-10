import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AiSettingsRepository } from '../server/persistence/ai.repository.js';
import { AiSettingsService } from '../server/terminal/ai/settings.js';
test('multiple providers isolate credentials, retain key on edit and validate native protocols', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-profiles-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const s = new AiSettingsService(new AiSettingsRepository(db));
  const a = s.saveProvider('a', {
    name: 'Claude',
    protocol: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'model',
    apiKey: 'secret',
  });
  const b = s.saveProvider('a', {
    name: 'Local',
    protocol: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'local',
  });
  assert.equal(s.listProviders('a').length, 2);
  assert.equal(s.listProviders('b').length, 0);
  assert.equal(s.privateSettings('a', a.id).protocol, 'claude');
  assert.equal(s.listProviders('a').find((p) => p.id === a.id).apiKey, undefined);
  assert.equal(s.readProvider('a', a.id).apiKey, 'secret');
  assert.throws(() => s.readProvider('b', a.id));
  s.saveProvider(
    'a',
    { name: 'Claude', protocol: 'claude', baseUrl: 'https://api.anthropic.com/v1/', model: 'next' },
    a.id,
  );
  assert.equal(s.privateSettings('a', a.id).apiKey, 'secret');
  s.saveProvider(
    'a',
    { name: 'Claude', protocol: 'claude', baseUrl: 'https://different.test/v1', model: 'next' },
    a.id,
  );
  assert.equal(s.privateSettings('a', a.id).apiKey, '');
  s.saveProvider(
    'a',
    {
      name: 'Claude',
      protocol: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'next',
      apiKey: 'secret',
    },
    a.id,
  );
  s.saveProvider(
    'a',
    {
      name: 'Renamed',
      protocol: 'claude',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'next',
      apiKey: '',
    },
    a.id,
  );
  assert.equal(s.privateSettings('a', a.id).apiKey, '');
  assert.throws(() => s.privateSettings('b', a.id));
  assert.throws(() => s.deleteProvider('b', a.id));
  assert.throws(() =>
    s.saveProvider('a', { name: 'Bad', protocol: 'invalid', baseUrl: 'http://local', model: 'x' }),
  );
  s.deleteProvider('a', b.id);
  assert.equal(s.listProviders('a').length, 1);
});
test('schema v3 settings migrate once into providers while retaining old business rows', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/ai-v4-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  for (const name of [
    'ai_skill_authorizations',
    'ai_skill_package_files',
    'ai_skill_packages',
    'ai_skills',
    'ai_chat_attachments',
    'ai_chat_protocol',
    'ai_chat_proposals',
    'ai_chat_messages',
    'ai_chats',
    'ai_providers',
  ])
    db.connection.exec('DROP TABLE ' + name);
  db.connection.exec(
    legacyNotificationReset + "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; CREATE TABLE ai_settings(owner_uid TEXT PRIMARY KEY NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,api_key TEXT NOT NULL,updated_at INTEGER NOT NULL) STRICT;INSERT INTO ai_settings VALUES('a','http://local/v1','test','key',1);DELETE FROM schema_migrations;INSERT INTO schema_migrations VALUES(3,1);ALTER TABLE icons DROP COLUMN menu_page; DELETE FROM schema_migrations WHERE version=8; DELETE FROM schema_migrations WHERE version>=9; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=3;INSERT INTO icons(id,name,url,mode)VALUES('keep','Keep','http://test','url')",
  );
  db.connection.exec(
    'ALTER TABLE user_preferences DROP COLUMN default_page; ALTER TABLE user_preferences DROP COLUMN navigation_motion',
  );
  db.close();
  db = new DatabaseService(dir);
  assert.equal(db.connection.prepare('pragma user_version').get().user_version, 34);
  assert.equal(db.connection.prepare('select id from icons').get().id, 'keep');
  const s = new AiSettingsService(new AiSettingsRepository(db));
  assert.equal(s.listProviders('a').length, 1);
  assert.equal(s.privateSettings('a').apiKey, 'key');
  assert.equal(db.connection.prepare('pragma foreign_key_check').all().length, 0);
  db.close();
  db = new DatabaseService(dir);
  assert.equal(new AiSettingsRepository(db).list('a').length, 1);
  db.close();
});

test('all vendor protocols persist in strict SQLite provider records', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/all-protocols-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const settings = new AiSettingsService(new AiSettingsRepository(db));
  for (const protocol of ['gemini', 'glm', 'minimax', 'deepseek', 'mimo']) {
    const saved = settings.saveProvider('a', {
      name: protocol,
      protocol,
      baseUrl: 'https://example.test/v1',
      model: 'fixture',
      apiKey: 'key',
    });
    assert.equal(saved.protocol, protocol);
    assert.equal(saved.apiKey, 'key');
  }
  assert.equal(settings.listProviders('a').length, 5);
  assert.equal(settings.listProviders('b').length, 0);
});
