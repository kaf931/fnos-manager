import { legacyNotificationReset } from './fixtures/notification-schema.js';
import { BackupService } from '../server/backup/service.js';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { RdpRepository } from '../server/persistence/rdp.repository.js';
import { VncRepository } from '../server/persistence/vnc.repository.js';
import { BackupRepository } from '../server/persistence/backup.repository.js';
test('v22 migration preserves VNC and RDP backup persists through reopen', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rdp-migration-'));
  let db = new DatabaseService(dir);
  try {
    new VncRepository(db).save('1000', {
      name: 'VNC',
      protocol: 'vnc',
      host: 'localhost',
      port: 5900,
    });
    db.connection.exec(
      legacyNotificationReset +
        'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE rdp_connections; DELETE FROM schema_migrations WHERE version=23; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=22',
    );
    db.close();
    db = new DatabaseService(dir);
    assert.equal(new VncRepository(db).list('1000').length, 1);
    const repo = new RdpRepository(db);
    const row = repo.save('1000', {
      name: 'RDP',
      protocol: 'rdp',
      host: 'win.local',
      port: 3389,
      username: 'user',
      password: 'secret',
      domain: 'WORK',
    });
    assert.equal(
      new BackupRepository(db).snapshot('1000').find((x) => x.kind === 'rdp').data.domain,
      'WORK',
    );
    db.close();
    db = new DatabaseService(dir);
    assert.equal(new RdpRepository(db).get('1000', row.id).password, 'secret');
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('schema26 RDP connections retain strict NLA and new policies survive reopen and backup restore', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rdp-security-migration-'));
  let db = new DatabaseService(dir);
  try {
    const input = {
      name: 'Windows',
      protocol: 'rdp',
      host: 'win.local',
      port: 3389,
      username: 'u',
      password: 'p',
      domain: '',
    };
    const saved = new RdpRepository(db).save('1000', input);
    db.connection.exec(
      legacyNotificationReset +
        'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE adb_connections; DELETE FROM schema_migrations WHERE version=29; ALTER TABLE update_settings DROP COLUMN download_route; DELETE FROM schema_migrations WHERE version=28; ALTER TABLE rdp_connections DROP COLUMN security; ALTER TABLE rdp_connections DROP COLUMN certificate_policy; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; PRAGMA user_version=26',
    );
    db.close();
    db = new DatabaseService(dir);
    let repo = new RdpRepository(db);
    assert.equal(repo.get('1000', saved.id).security, 'nla');
    assert.equal(repo.get('1000', saved.id).certificatePolicy, 'strict');
    repo.save('1000', { ...input, security: 'any', certificatePolicy: 'tofu' }, saved.id);
    const snapshot = new BackupRepository(db).snapshot('1000').find((x) => x.kind === 'rdp');
    assert.equal(snapshot.data.security, 'any');
    assert.equal(snapshot.data.certificatePolicy, 'tofu');
    const service = new BackupService(db, 'test');
    const preview = await service.preview('1001', {
      format: 'fnos-manager-config',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: 'test',
      includeCredentials: true,
      items: [snapshot],
    });
    await service.restore('1001', { token: preview.token, requestId: randomUUID(), decisions: [] });
    db.close();
    db = new DatabaseService(dir);
    repo = new RdpRepository(db);
    assert.equal(repo.list('1001')[0].certificatePolicy, 'tofu');
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
