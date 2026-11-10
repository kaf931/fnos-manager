import { legacyNotificationReset } from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, entryConfig } from '../server/core.js';
import { resolveMenuEntry } from '../.web-test/menu-entry.js';
import { DatabaseService } from '../server/persistence/database.service.js';
import { IconRepository } from '../server/persistence/icon.repository.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareShortcut } from '../server/package.js';
import { defaultIcon } from '../server/icons.js';
test('internal menu entries use a canonical relative gateway route and cannot override it', () => {
  const valid = validateEntry({
    name: 'SSH 终端',
    menuPage: 'terminal',
    url: 'https://evil.test',
    mode: 'url',
    containerId: 'external',
  });
  assert.equal(valid.url, '/app/deskicons/?page=terminal&standalone=1');
  assert.equal(valid.mode, 'iframe');
  assert.equal(valid.containerId, null);
  assert.throws(() => validateEntry({ name: 'Bad', menuPage: 'javascript:bad' }));
  assert.throws(() => validateEntry({ name: 'Bad', url: '/app/deskicons/?page=terminal' }));
  const config = entryConfig({ ...valid, id: 'menu123' })['.url']['deskicon.menu123.main'];
  assert.equal(config.url, valid.url);
  assert.equal(config.type, 'iframe');
  assert.equal(config.protocol, '');
  assert.equal(config.allUsers, false);
});
test('entry routing hides navigation only for a valid explicit standalone page', () => {
  assert.deepEqual(resolveMenuEntry('?page=terminal&standalone=1', 'wake'), {
    page: 'terminal',
    standalone: true,
  });
  assert.deepEqual(resolveMenuEntry('?page=evil&standalone=1', 'wake'), {
    page: 'wake',
    standalone: false,
  });
  assert.deepEqual(resolveMenuEntry('', 'tasks'), { page: 'tasks', standalone: false });
  assert.deepEqual(resolveMenuEntry('?page=storage', 'icons'), {
    page: 'storage',
    standalone: false,
  });
  assert.deepEqual(resolveMenuEntry('?page=terminal&page=wake&standalone=1', 'icons'), {
    page: 'icons',
    standalone: false,
  });
});
test('v7 migration preserves icons and menu metadata persists with a database constraint', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-menu-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  db.connection.exec(
    legacyNotificationReset +
      "DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; ALTER TABLE icons DROP COLUMN menu_page; DELETE FROM schema_migrations WHERE version=8; DROP TABLE ai_skill_authorizations; DROP TABLE ai_skill_package_files; DROP TABLE ai_skill_packages; ALTER TABLE ai_chat_proposals DROP COLUMN action; DELETE FROM schema_migrations WHERE version>=12; DROP TABLE ai_skills; DELETE FROM schema_migrations WHERE version=11; DROP TABLE ai_chat_attachments; DELETE FROM schema_migrations WHERE version>=9; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=7; INSERT INTO icons(id,name,url,mode)VALUES('keep01','Keep','http://test','url')",
  );
  db.close();
  db = new DatabaseService(dir);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
  const repo = new IconRepository(db);
  assert.equal(repo.find('keep01').name, 'Keep');
  assert.equal(repo.find('keep01').menuPage, null);
  const entry = {
    ...validateEntry({ name: 'SSH', menuPage: 'terminal' }),
    id: 'menu123',
    revision: 1,
    appliedRevision: 0,
    iconSource: 'NAS 管家',
  };
  repo.save(entry);
  assert.equal(repo.find('menu123').menuPage, 'terminal');
  assert.throws(() => db.connection.exec("UPDATE icons SET menu_page='bad' WHERE id='menu123'"));
  db.close();
  db = new DatabaseService(dir);
  t.after(() => db.close());
  assert.equal(new IconRepository(db).find('menu123').url, entry.url);
});
test('shortcut package has a main-app dependency and a relative target', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-menu-pack-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = {
    ...validateEntry({ name: 'SSH', menuPage: 'terminal' }),
    id: 'menu123',
    revision: 1,
    appliedRevision: 0,
    iconSource: 'NAS 管家',
  };
  await prepareShortcut(dir, entry, await defaultIcon());
  assert.match(await readFile(path.join(dir, 'manifest'), 'utf8'), /install_dep_apps=deskicons/);
  assert.match(
    await readFile(path.join(dir, 'app/ui/index.cgi'), 'utf8'),
    /\/app\/deskicons\/\?page=terminal&standalone=1/,
  );
});

test('menu icon API persists its selected feature and rejects forged menu names', async (t) => {
  const { appFixture } = await import('./fixtures/terminal-app.js');
  const f = await appFixture();
  t.after(f.close);
  const post = (body) =>
    fetch(f.base + '/entries', { method: 'POST', headers: f.headers, body: JSON.stringify(body) });
  const r = await post({ name: 'SSH', menuPage: 'terminal' });
  assert.equal(r.status, 201);
  const entry = await r.json();
  assert.equal(entry.menuPage, 'terminal');
  assert.equal(entry.url, '/app/deskicons/?page=terminal&standalone=1');
  const list = await (await fetch(f.base + '/entries', { headers: f.headers })).json();
  assert.equal(list[0].menuPage, 'terminal');
  assert.equal((await post({ name: 'Bad', menuPage: 'invalid' })).status, 400);
  assert.equal((await post({ name: 'Bad' })).status, 400);
});

test('standalone HTML records launch state before the single React shell mounts', async (t) => {
  const { JSDOM } = await import('jsdom');
  const { createApplication } = await import('../server/index.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-entry-first-paint-'));
  const app = await createApplication({ dataDir: dir });
  const server = await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/app/deskicons/`;
  for (const suffix of ['?page=terminal&standalone=1', 'index.html?page=settings&standalone=1']) {
    const response = await fetch(base + suffix);
    assert.equal(response.status, 200);
    const dom = new JSDOM(await response.text());
    const root = dom.window.document;
    assert.ok(root.documentElement.classList.contains('standalone-entry'));
    assert.equal(
      root.documentElement.dataset.initialPage,
      suffix.includes('terminal') ? 'terminal' : 'settings',
    );
    assert.equal(root.querySelector('.sidebar'), null);
    assert.equal(root.querySelector('#app').children.length, 0);
    dom.window.close();
  }
  for (const suffix of [
    '',
    '?page=terminal',
    '?page=unknown&standalone=1',
    '?page=terminal&page=wake&standalone=1',
  ]) {
    const dom = new JSDOM(await (await fetch(base + suffix)).text());
    assert.equal(dom.window.document.documentElement.classList.contains('standalone-entry'), false);
    assert.equal(dom.window.document.documentElement.dataset.initialPage, undefined);
    assert.equal(dom.window.document.querySelector('.sidebar'), null);
    dom.window.close();
  }
});
