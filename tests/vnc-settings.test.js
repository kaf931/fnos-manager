import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appFixture } from './fixtures/terminal-app.js';
import { DatabaseService } from '../server/persistence/database.service.js';
import { VncRepository } from '../server/persistence/vnc.repository.js';

const defaults = {
  shared: true,
  viewOnly: false,
  clipViewport: false,
  scaleMode: 'scale',
  qualityLevel: 6,
  compressionLevel: 2,
  cursorMode: 'remote',
  showDotCursor: true,
  autoReconnect: false,
  reconnectDelay: 5000,
  repeaterId: '',
  logging: 'warn',
};
const custom = {
  shared: false,
  viewOnly: true,
  clipViewport: true,
  scaleMode: 'remote',
  qualityLevel: 9,
  compressionLevel: 0,
  cursorMode: 'local',
  showDotCursor: false,
  autoReconnect: true,
  reconnectDelay: 60000,
  repeaterId: 'ID:12345',
  logging: 'debug',
};

test('VNC settings return defaults and persist isolated full owner settings with admin/CSRF protection', async () => {
  const f = await appFixture();
  const call = (method = 'GET', body, extra = {}) =>
    fetch(f.base + '/vnc/settings', {
      method,
      headers: { ...f.headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const initial = await call();
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), defaults);
    assert.equal((await call('GET', undefined, { 'x-trim-isadmin': 'false' })).status, 403);
    assert.equal((await call('PUT', custom, { 'x-trim-isadmin': 'false' })).status, 403);
    assert.equal((await call('PUT', custom, { 'x-deskicons-token': 'wrong' })).status, 403);
    const saved = await call('PUT', custom);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), custom);
    assert.deepEqual(await (await call()).json(), custom);
    assert.deepEqual(
      await (await call('GET', undefined, { 'x-trim-userid': '1001' })).json(),
      defaults,
    );
    assert.equal((await call('PUT', defaults, { 'x-trim-userid': '1001' })).status, 200);
    assert.deepEqual(await (await call()).json(), custom);
  } finally {
    await f.close();
  }
});

test('VNC settings reject incomplete, coercible, out-of-range, control-character and arbitrary URL fields', async () => {
  const f = await appFixture();
  try {
    const invalid = [
      {},
      null,
      [],
      { ...defaults, shared: 'false' },
      { ...defaults, qualityLevel: 1.5 },
      { ...defaults, qualityLevel: -1 },
      { ...defaults, qualityLevel: 10 },
      { ...defaults, compressionLevel: 10 },
      { ...defaults, reconnectDelay: 999 },
      { ...defaults, reconnectDelay: 60001 },
      { ...defaults, repeaterId: 'x'.repeat(251) },
      { ...defaults, scaleMode: 'fit' },
      { ...defaults, cursorMode: 'none' },
      { ...defaults, logging: 'trace' },
      { ...defaults, url: 'ws://example.com' },
      { ...defaults, wsUrl: 'ws://example.com' },
      ...['\u0000', '\n', '\t', '\u007f', '\u0085'].map((c) => ({
        ...defaults,
        repeaterId: 'a' + c + 'b',
      })),
    ];
    for (const body of invalid) {
      const response = await fetch(f.base + '/vnc/settings', {
        method: 'PUT',
        headers: f.headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(
      await (await fetch(f.base + '/vnc/settings', { headers: f.headers })).json(),
      defaults,
    );
  } finally {
    await f.close();
  }
});

test('VNC preferences migrate version 19, survive reopening and enforce SQLite constraints', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vnc-settings-'));
  let db;
  try {
    db = new DatabaseService(dir);
    db.connection.exec(
      legacyNotificationReset + 'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE rdp_connections; DELETE FROM schema_migrations WHERE version=23; DROP TABLE history_limits; DROP TABLE IF EXISTS vnc_preferences; DELETE FROM schema_migrations WHERE version>19; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=19',
    );
    db.close();
    db = new DatabaseService(dir);
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 33);
    assert.equal(
      db.connection.prepare('SELECT version FROM schema_migrations WHERE version=20').get().version,
      20,
    );
    assert.equal(
      db.connection
        .prepare("SELECT strict FROM pragma_table_list WHERE name='vnc_preferences'")
        .get().strict,
      1,
    );
    new VncRepository(db).saveSettings('1000', custom);
    db.close();
    db = new DatabaseService(dir);
    assert.deepEqual(new VncRepository(db).getSettings('1000'), custom);
    assert.deepEqual(new VncRepository(db).getSettings('1001'), defaults);
    for (const [column, value] of [
      ['shared', 2],
      ['view_only', null],
      ['quality_level', 10],
      ['compression_level', -1],
      ['scale_mode', 'fit'],
      ['cursor_mode', 'none'],
      ['logging', 'trace'],
      ['reconnect_delay', 999],
      ['repeater_id', 'a\nb'],
      ['repeater_id', '\u0000'],
      ['repeater_id', '\u0085'],
      ['repeater_id', 'x'.repeat(251)],
    ]) {
      assert.throws(() =>
        db.connection
          .prepare(`UPDATE vnc_preferences SET ${column}=? WHERE owner_uid='1000'`)
          .run(value),
      );
    }
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('VNC cursor migration preserves v21 preferences and defaults existing owners to remote', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vnc-cursor-'));
  let db = new DatabaseService(dir);
  try {
    new VncRepository(db).saveSettings('1000', custom);
    db.connection.exec(
      legacyNotificationReset + 'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE rdp_connections; DELETE FROM schema_migrations WHERE version=23; ALTER TABLE vnc_preferences DROP COLUMN cursor_mode; DELETE FROM schema_migrations WHERE version=22; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=21',
    );
    db.close();
    db = new DatabaseService(dir);
    assert.deepEqual(new VncRepository(db).getSettings('1000'), {
      ...custom,
      cursorMode: 'remote',
    });
    new VncRepository(db).saveSettings('1000', custom);
    db.close();
    db = new DatabaseService(dir);
    assert.deepEqual(new VncRepository(db).getSettings('1000'), custom);
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
