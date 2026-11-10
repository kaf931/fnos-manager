import {
  legacyNotificationReset,
  legacyNotificationSchema,
} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { PreferencesRepository } from '../server/persistence/preferences.repository.js';
import { appFixture } from './fixtures/terminal-app.js';

test('system settings preserve per-user values and catalog flags through partial saves and reopen', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  let prefs = new PreferencesRepository(db);
  assert.equal(prefs.get('a').defaultPage, 'icons');
  assert.equal(prefs.get('a').navigationMotion, true);
  prefs.save('a', { defaultPage: 'wake', navigationMotion: false, theme: 'dark' });
  db.connection
    .prepare('UPDATE user_preferences SET catalog_initialized=1 WHERE owner_uid=?')
    .run('a');
  prefs.save('a', { commandHints: false });
  db.close();
  db = new DatabaseService(dir);
  t.after(() => db.close());
  prefs = new PreferencesRepository(db);
  assert.deepEqual(prefs.get('a'), {
    theme: 'dark',
    palette: 'classic',
    terminalBackground: 'striped',
    commandHints: false,
    defaultPage: 'wake',
    navigationMotion: false,
  });
  assert.equal(prefs.get('b').defaultPage, 'icons');
  assert.equal(
    db.connection
      .prepare('SELECT catalog_initialized n FROM user_preferences WHERE owner_uid=?')
      .get('a').n,
    1,
  );
  assert.throws(() => db.connection.exec("UPDATE user_preferences SET default_page='arbitrary'"));
  assert.throws(() => db.connection.exec('UPDATE user_preferences SET navigation_motion=2'));
});

test('v6 upgrade adds settings without changing saved preferences or business data', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-settings-upgrade-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  new PreferencesRepository(db).save('a', { theme: 'dark', commandHints: false });
  db.connection.exec(
    legacyNotificationReset +
      "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; ALTER TABLE user_preferences DROP COLUMN default_page; ALTER TABLE user_preferences DROP COLUMN navigation_motion; DELETE FROM schema_migrations WHERE version=7; ALTER TABLE icons DROP COLUMN menu_page; DELETE FROM schema_migrations WHERE version=8; DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11; DROP TABLE ai_chat_attachments; DELETE FROM schema_migrations WHERE version>=9; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=6; INSERT INTO icons(id,name,url,mode)VALUES('keep01','Keep','http://test','url')",
  );
  db.close();
  db = new DatabaseService(dir);
  t.after(() => db.close());
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(new PreferencesRepository(db).get('a'), {
    theme: 'dark',
    palette: 'classic',
    terminalBackground: 'striped',
    commandHints: false,
    defaultPage: 'icons',
    navigationMotion: true,
  });
  assert.equal(db.connection.prepare('SELECT count(*) n FROM icons').get().n, 1);
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});

test('settings API rejects unknown menu names, wrong toggle types and missing CSRF', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const save = (patch, extra = {}) =>
    fetch(f.base + '/preferences', {
      method: 'PUT',
      headers: { ...f.headers, ...extra },
      body: JSON.stringify(patch),
    });
  assert.equal((await save({ defaultPage: 'terminal', navigationMotion: false })).status, 200);
  assert.equal((await save({ defaultPage: 'settings' })).status, 400);
  assert.equal((await save({ navigationMotion: 'false' })).status, 400);
  assert.equal((await save({ defaultPage: 'icons' }, { 'x-deskicons-token': 'bad' })).status, 403);
});

test('appearance choices persist independently per user and reject invalid API choices', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const save = (patch) =>
    fetch(f.base + '/preferences', {
      method: 'PUT',
      headers: f.headers,
      body: JSON.stringify(patch),
    });
  const initial = await (await fetch(f.base + '/preferences', { headers: f.headers })).json();
  assert.equal(initial.palette, 'classic');
  assert.equal(initial.terminalBackground, 'striped');
  const response = await save({ palette: 'teal', terminalBackground: 'solid' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).palette, 'teal');
  await save({ theme: 'dark' });
  const current = await (await fetch(f.base + '/preferences', { headers: f.headers })).json();
  assert.equal(current.terminalBackground, 'solid');
  assert.equal(current.palette, 'teal');
  assert.equal((await save({ palette: 'default' })).status, 200);
  assert.equal((await save({ palette: 'unknown' })).status, 400);
  assert.equal((await save({ terminalBackground: 'unknown' })).status, 400);
});

test('v23 appearance migration preserves previous preferences and enforces palette constraints', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'appearance-upgrade-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  new PreferencesRepository(db).save('a', { theme: 'dark', navigationMotion: false });
  db.connection.exec(
    legacyNotificationReset +
      'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; ALTER TABLE rdp_connections DROP COLUMN security; ALTER TABLE rdp_connections DROP COLUMN certificate_policy; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=23',
  );
  db.close();
  db = new DatabaseService(dir);
  const repo = new PreferencesRepository(db);
  assert.equal(repo.get('a').theme, 'dark');
  assert.equal(repo.get('a').navigationMotion, false);
  assert.equal(repo.get('a').palette, 'classic');
  repo.save('a', { palette: 'mist', terminalBackground: 'solid' });
  assert.equal(repo.get('b').palette, 'classic');
  assert.throws(() => db.connection.exec("UPDATE user_preferences SET palette='invalid'"));
  assert.throws(() =>
    db.connection.exec("UPDATE user_preferences SET terminal_background='invalid'"),
  );
  db.close();
  db = new DatabaseService(dir);
  t.after(() => db.close());
  assert.equal(new PreferencesRepository(db).get('a').terminalBackground, 'solid');
  assert.equal(new PreferencesRepository(db).get('a').palette, 'mist');
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});

test('backup preferences preserve appearance and old backups receive appearance defaults', async () => {
  const { normalizeItem } = await import('../server/backup/validation.js');
  const data = { theme: 'dark', commandHints: true, defaultPage: 'icons', navigationMotion: true };
  const normalize = (patch) =>
    normalizeItem({ kind: 'preferences', id: 'preferences', data: { ...data, ...patch } }).data;
  assert.equal(normalize({}).palette, 'classic');
  assert.equal(normalize({}).terminalBackground, 'striped');
  assert.equal(normalize({ palette: 'teal', terminalBackground: 'solid' }).palette, 'teal');
  assert.equal(
    normalize({ palette: 'teal', terminalBackground: 'solid' }).terminalBackground,
    'solid',
  );
  assert.equal(normalize({ palette: 'default' }).palette, 'default');
  assert.throws(() => normalize({ palette: 'unknown' }));
});

test('v24 palette expansion keeps preferences and catalog children and accepts original blue', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { schema } = await import('../server/persistence/schema.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'palette-v24-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const raw = new DatabaseSync(path.join(dir, 'nas-manager.sqlite'));
  raw.exec(
    legacyNotificationSchema(schema)
      .replace(
        "CHECK(palette IN ('classic','mist','teal','default'))",
        "CHECK(palette IN ('classic','mist','teal'))",
      )
      .replace(/CREATE TABLE update_settings[\s\S]*?\) STRICT;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(26[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(25[^;]*;/, '')
      .replace(/ALTER TABLE rdp_connections ADD COLUMN[^;]*;/g, '')
      .replace(/INSERT INTO schema_migrations VALUES\(27[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(28[^;]*;/, '')
      .replace(/CREATE TABLE adb_connections[\s\S]*?CREATE INDEX adb_connections_owner[^;]*;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(29[^;]*;/, '')
      .replace(/CREATE TABLE IF NOT EXISTS notification_options[\s\S]*?\) STRICT;/, '')
      .replace(/INSERT INTO schema_migrations VALUES\(30[^;]*;/, '')
      .replace('PRAGMA user_version=30', 'PRAGMA user_version=24'),
  );
  raw.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO user_preferences(owner_uid,theme,catalog_initialized,updated_at,palette) VALUES('a','dark',1,1,'teal'); INSERT INTO command_catalog VALUES('command','a','pwd','Show directory','General',0,1,1)",
  );
  assert.throws(() => raw.exec("UPDATE user_preferences SET palette='default'"));
  raw.close();
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const prefs = new PreferencesRepository(db);
  assert.equal(prefs.get('a').palette, 'teal');
  assert.equal(prefs.get('a').theme, 'dark');
  assert.equal(db.connection.prepare('SELECT count(*) n FROM command_catalog').get().n, 1);
  assert.equal(
    db.connection
      .prepare("SELECT catalog_initialized FROM user_preferences WHERE owner_uid='a'")
      .get().catalog_initialized,
    1,
  );
  prefs.save('a', { palette: 'default' });
  assert.equal(prefs.get('a').palette, 'default');
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});
