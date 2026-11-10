import { beforeReminderRecurrenceSchema } from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
import { schema, notificationTemplateOrderSchema } from '../server/persistence/schema.js';

test('template ordering migrates from version 33, persists and rejects foreign or invalid entries', () => {
  const dir = mkdtempSync(tmpdir() + '/template-order-');
  let db;
  try {
    const old = new DatabaseSync(dir + '/nas-manager.sqlite');
    old.exec(
      beforeReminderRecurrenceSchema(schema)
        .replace(notificationTemplateOrderSchema, '')
        .replace(/INSERT INTO schema_migrations VALUES\(34[^;]*;/, '')
        .replace('PRAGMA user_version=34', 'PRAGMA user_version=33'),
    );
    old.close();
    db = new DatabaseService(dir);
    let repo = new NotificationRepository(db);
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
    assert.deepEqual(repo.templateOrder('a'), { keys: [] });
    const row = repo.createTemplate('a', {
      channel: 'inapp',
      name: 'Mine',
      enabled: true,
      url: '',
      token: '',
      condition: 'all',
      scanFailures: true,
    });
    const keys = ['channel:email', 'template:' + row.id, 'channel:webhook'];
    const saved = repo.saveTemplateOrder('a', keys);
    assert.deepEqual(saved.keys, [
      'channel:email',
      'template:' + row.id,
      'channel:inapp',
      'channel:webhook',
    ]);
    assert.deepEqual(repo.templateOrder('b').keys, []);
    assert.throws(() => repo.saveTemplateOrder('b', keys));
    for (const bad of [[], ['channel:unknown'], ['channel:email', 'channel:email']])
      assert.throws(() => repo.saveTemplateOrder('a', bad));
    db.close();
    db = new DatabaseService(dir);
    repo = new NotificationRepository(db);
    assert.deepEqual(repo.templateOrder('a'), saved);
    assert.equal(repo.listTemplates('a')[0].name, 'Mine');
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
