import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { CommandRepository } from '../server/persistence/command.repository.js';
import { PreferencesRepository } from '../server/persistence/preferences.repository.js';
import { appFixture } from './fixtures/terminal-app.js';

test('command catalog and preferences persist in SQLite with strict owner isolation', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-commands-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  const library = new CommandRepository(db).list('a');
  assert.ok(library.length >= 120);
  assert.equal(new Set(library.map((x) => x.command)).size, library.length);
  for (const prefix of ['ls', 'find', 'tar', 'docker', 'systemctl', 'ss', 'git', 'rsync'])
    assert.ok(library.some((x) => x.command.startsWith(prefix) && x.description && x.category));
  assert.ok(library.every((x) => !/[\r\n\x00-\x1f\x7f]/.test(x.command)));
  const commands = new CommandRepository(db);
  const deleted = library[0].id;
  commands.remove('a', deleted);
  commands.save('a', { command: 'printf custom', description: '自定义', category: '自定义' });
  const prefs = new PreferencesRepository(db);
  assert.deepEqual(prefs.get('a'), {
    theme: 'system',
    palette: 'classic',
    terminalBackground: 'striped',
    commandHints: true,
    defaultPage: 'icons',
    navigationMotion: true,
  });
  prefs.save('a', { commandHints: false, theme: 'dark' });
  prefs.save('a', { theme: 'light' });
  assert.equal(prefs.get('b').commandHints, true);
  db.close();
  db = new DatabaseService(dir);
  t.after(() => db.close());
  assert.deepEqual(new PreferencesRepository(db).get('a'), {
    theme: 'light',
    palette: 'classic',
    terminalBackground: 'striped',
    commandHints: false,
    defaultPage: 'icons',
    navigationMotion: true,
  });
  assert.equal(new CommandRepository(db).list('a').length, library.length);
  assert.ok(!new CommandRepository(db).list('a').some((e) => e.id === deleted));
  assert.ok(new CommandRepository(db).list('a').some((e) => e.command === 'printf custom'));
  assert.throws(() => db.connection.prepare('UPDATE user_preferences SET command_hints=2').run());
});

test('v5 upgrade imports icon binaries before removing old PNG files and survives reopen', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-icon-blob-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  db.connection.exec(
    legacyNotificationReset + "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; INSERT INTO icons(id,name,url,mode)VALUES('image01','Icon','http://test','url'); DROP TABLE icon_images; DROP TABLE command_catalog; DROP TABLE user_preferences; DELETE FROM schema_migrations WHERE version>=6; ALTER TABLE icons DROP COLUMN menu_page; DELETE FROM schema_migrations WHERE version=8; DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11; DROP TABLE ai_chat_attachments; DELETE FROM schema_migrations WHERE version>=9; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=5",
  );
  db.close();
  const image = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  await mkdir(path.join(dir, 'icons'));
  const file = path.join(dir, 'icons/image01.png');
  await writeFile(file, image);
  db = new DatabaseService(dir);
  assert.deepEqual(
    Buffer.from(
      db.connection.prepare('SELECT image FROM icon_images WHERE icon_id=?').get('image01').image,
    ),
    image,
  );
  await assert.rejects(access(file));
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 33);
  db.close();
  db = new DatabaseService(dir);
  t.after(() => db.close());
  assert.equal(db.connection.prepare('SELECT count(*) n FROM icon_images').get().n, 1);
  db.connection.prepare('DELETE FROM icons WHERE id=?').run('image01');
  assert.equal(db.connection.prepare('SELECT count(*) n FROM icon_images').get().n, 0);
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});

test('command and preference APIs enforce access, CSRF and typed settings', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const call = (method = 'GET', body, extra = {}) =>
    fetch(f.base + '/preferences', {
      method,
      headers: { ...f.headers, ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal((await f.call('/command-catalog')).status, 200);
  assert.ok((await (await f.call('/command-catalog')).json()).length >= 120);
  assert.equal((await call('PUT', { commandHints: false })).status, 200);
  assert.equal((await (await call()).json()).commandHints, false);
  assert.equal(
    (await (await call('GET', null, { 'x-trim-userid': '1001' })).json()).commandHints,
    true,
  );
  assert.equal((await call('PUT', { commandHints: 'false' })).status, 400);
  assert.equal((await call('PUT', { theme: 'arbitrary' })).status, 400);
  assert.equal(
    (await call('PUT', { commandHints: true }, { 'x-deskicons-token': 'bad' })).status,
    403,
  );
  assert.equal((await call('GET', null, { 'x-trim-isadmin': 'false' })).status, 403);
});

test('new icon images are stored atomically as database blobs and cascade on delete', async (t) => {
  const f = await appFixture(false);
  t.after(f.close);
  const r = await fetch(f.base + '/entries', {
    method: 'POST',
    headers: { ...f.headers, Origin: f.origin },
    body: JSON.stringify({ name: 'Blob', url: 'http://nas:8096', mode: 'url' }),
  });
  assert.equal(r.status, 201);
  const entry = await r.json();
  const icon = await fetch(f.base + '/entries/' + entry.id + '/icon', { headers: f.headers });
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  const image = Buffer.from(await icon.arrayBuffer());
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const db = f.app.get(DatabaseService);
  assert.deepEqual(
    Buffer.from(
      db.connection.prepare('SELECT image FROM icon_images WHERE icon_id=?').get(entry.id).image,
    ),
    image,
  );
  assert.equal(
    (
      await fetch(f.base + '/entries/' + entry.id, {
        method: 'DELETE',
        headers: { ...f.headers, Origin: f.origin },
      })
    ).status,
    204,
  );
  assert.equal(db.connection.prepare('SELECT count(*) n FROM icon_images').get().n, 0);
});

test('catalog CRUD is scoped, preserves edits and deletions after restart and cannot inject control characters', async (t) => {
  const f = await appFixture();
  t.after(f.close);
  const list = await (await f.call('/command-catalog')).json();
  const builtin = list[0];
  const saved = await f.call('/command-catalog', 'POST', {
    command: 'printf test',
    description: '测试',
    category: '自定义',
  });
  assert.equal(saved.status, 201);
  const custom = await saved.json();
  assert.equal(
    (
      await f.call('/command-catalog', 'POST', {
        command: 'printf test',
        description: '重复',
        category: '自定义',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call('/command-catalog/' + custom.id, 'PUT', {
        command: 'printf changed',
        description: '修改',
        category: '自定义',
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call('/command-catalog/' + custom.id, 'DELETE', null, { 'x-trim-userid': '1001' }))
      .status,
    404,
  );
  assert.equal((await f.call('/command-catalog/' + builtin.id, 'DELETE')).status, 204);
  const own = await (await f.call('/command-catalog')).json();
  assert.ok(!own.some((e) => e.id === builtin.id));
  assert.ok(own.some((e) => e.command === 'printf changed'));
  const other = await (
    await f.call('/command-catalog', 'GET', null, { 'x-trim-userid': '1001' })
  ).json();
  assert.ok(other.some((e) => e.command === builtin.command));
  assert.ok(!other.some((e) => e.command === 'printf changed'));
  assert.equal(
    (
      await f.call('/command-catalog', 'POST', {
        command: 'pwd\nls',
        description: '错误',
        category: '自定义',
      })
    ).status,
    400,
  );
  const db = f.app.get(DatabaseService);
  const again = new CommandRepository(db);
  assert.ok(!again.list('1000').some((e) => e.id === builtin.id));
  assert.equal((await f.call('/command-catalog/' + custom.id, 'DELETE')).status, 204);
});
