import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { RetentionRepository } from '../server/persistence/retention.repository.js';
import { MaintenanceRecordRepository } from '../server/persistence/maintenance-record.repository.js';
function fixture(t) {
  const dir = mkdtempSync(tmpdir() + '/notification-cleanup-');
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const c = db.connection;
  for (const owner of ['a', 'b']) {
    for (const channel of ['inapp', 'webhook']) {
      for (let i = 0; i < 4; i++)
        c.prepare(
          `INSERT INTO notification_deliveries(id,owner_uid,channel,event_id,event_type,name,payload,revision,status,created_at) VALUES(?,?,?,?,'test',?,'{"message":"消息正文"}',1,?,?)`,
        ).run(
          owner + channel + i,
          owner,
          channel,
          channel + 'e' + i,
          '通知' + i,
          i === 0 ? 'pending' : 'success',
          i,
        );
    }
    for (const [id, status, repeat] of [
      ['todo', 'open', 'none'],
      ['recurring', 'completed', 'daily'],
      ['done1', 'completed', 'none'],
      ['done2', 'completed', 'none'],
    ])
      c.prepare(
        `INSERT INTO reminders(id,owner_uid,name,content,repeat,template_ids,enabled,status,revision,created_at,updated_at,completed_at) VALUES(?,?,?,'提醒正文',?,'[]',0,?,1,1,1,?)`,
      ).run(id, owner, id, repeat, status, id === 'done2' ? 2 : 1);
  }
  return { db, c, repo: new RetentionRepository(db), details: new MaintenanceRecordRepository(db) };
}
test('notification cleanup separates quotas and clears only its channel and owner', (t) => {
  const { repo, c } = fixture(t);
  assert.equal(repo.limits().appMessages, 200);
  assert.equal(repo.limits().completedReminders, 100);
  repo.save({ ...repo.limits(), appMessages: 2, completedReminders: 1 });
  assert.deepEqual(repo.count('deliveries', 'a'), { count: 4, protected: 1 });
  assert.deepEqual(repo.count('appMessages', 'a'), { count: 4, protected: 1 });
  assert.equal(repo.trim('appMessages', 2).length, 2);
  assert.equal(repo.clear('deliveries', 'a').length, 3);
  assert.equal(
    c
      .prepare(
        "SELECT count(*) n FROM notification_deliveries WHERE owner_uid='a' AND channel='inapp'",
      )
      .get().n,
    3,
  );
  assert.equal(
    c
      .prepare(
        "SELECT count(*) n FROM notification_deliveries WHERE owner_uid='b' AND channel='webhook'",
      )
      .get().n,
    4,
  );
  assert.throws(() => repo.removeSelected('appMessages', 'a', ['binapp1']));
});
test('completed reminder cleanup protects pending and recurring reminders and other owners', (t) => {
  const { repo, c } = fixture(t);
  assert.deepEqual(repo.count('completedReminders', 'a'), { count: 3, protected: 1 });
  assert.throws(() => repo.removeSelected('completedReminders', 'a', ['recurring']));
  assert.throws(() => repo.removeSelected('completedReminders', 'a', ['todo']));
  assert.equal(repo.trim('completedReminders', 1).length, 2);
  assert.equal(repo.clear('completedReminders', 'a').length, 1);
  assert.deepEqual(
    c
      .prepare("SELECT id FROM reminders WHERE owner_uid='a' ORDER BY id")
      .all()
      .map((r) => r.id),
    ['recurring', 'todo'],
  );
  assert.equal(c.prepare("SELECT count(*) n FROM reminders WHERE owner_uid='b'").get().n, 3);
});
test('cleanup details paginate private messages and completed reminders with owner isolation', (t) => {
  const { details } = fixture(t);
  const messages = details.page('appMessages', 'a', 1, 2);
  assert.equal(messages.total, 4);
  assert.equal(messages.items.length, 2);
  assert.match(details.detail('appMessages', 'a', 'ainapp1').text, /消息正文/);
  assert.throws(() => details.detail('appMessages', 'a', 'binapp1'), /不存在/);
  assert.throws(() => details.detail('appMessages', 'a', 'awebhook1'), /不存在/);
  const reminders = details.page('completedReminders', 'a', 1, 10);
  assert.equal(reminders.total, 3);
  assert.equal(reminders.items.find((r) => r.id === 'recurring').status, 'protected');
  assert.match(details.detail('completedReminders', 'a', 'done1').text, /提醒正文/);
  assert.throws(() => details.detail('completedReminders', 'a', 'todo'), /不存在/);
});

test('schema35 cleanup migration preserves limits, reminders and messages and reopens idempotently', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { schema } = await import('../server/persistence/schema.js');
  const { beforeNotificationRetentionSchema } = await import('./fixtures/notification-schema.js');
  const dir = mkdtempSync(tmpdir() + '/cleanup-migration-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(dir + '/nas-manager.sqlite');
  old.exec(beforeNotificationRetentionSchema(schema));
  old.exec(
    "INSERT INTO history_limits VALUES(1,7,8,9,10,11,12,13); INSERT INTO reminders(id,owner_uid,name,content,repeat,template_ids,enabled,status,revision,created_at,updated_at) VALUES('keep','a','保留','正文','none','[]',0,'open',1,1,1)",
  );
  const original = old.prepare('SELECT * FROM reminders').get();
  old.close();
  let db = new DatabaseService(dir);
  const limits = new RetentionRepository(db).limits();
  assert.equal(limits.deliveries, 11);
  assert.equal(limits.serviceLogMiB, 13);
  assert.equal(limits.appMessages, 200);
  assert.equal(limits.completedReminders, 100);
  assert.deepEqual(db.connection.prepare('SELECT * FROM reminders').get(), original);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
  db.close();
  db = new DatabaseService(dir);
  assert.deepEqual(new RetentionRepository(db).limits(), limits);
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
});
