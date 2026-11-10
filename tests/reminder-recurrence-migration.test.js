import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../server/persistence/database.service.js';
import { schema } from '../server/persistence/schema.js';
import { beforeReminderRecurrenceSchema } from './fixtures/notification-schema.js';
test('schema34 recurrence migration preserves every existing reminder field and adds empty weekdays', (t) => {
  const dir = mkdtempSync(tmpdir() + '/reminder-v35-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(dir + '/nas-manager.sqlite');
  old.exec(beforeReminderRecurrenceSchema(schema));
  old
    .prepare(
      "INSERT INTO reminders(id,owner_uid,name,content,due_at,repeat,template_ids,enabled,status,next_at,last_fired_at,completed_at,revision,error,created_at,updated_at) VALUES('keep','a','保留提醒','正文',123,'monthly','[]',0,'open',456,789,NULL,3,'旧错误',11,22)",
    )
    .run();
  const original = old.prepare("SELECT * FROM reminders WHERE id='keep'").get();
  old.close();
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  const { weekdays, ...stored } = db.connection
    .prepare("SELECT * FROM reminders WHERE id='keep'")
    .get();
  assert.deepEqual(stored, { ...original });
  assert.equal(weekdays, '[]');
  assert.equal(db.connection.prepare('pragma user_version').get().user_version, 35);
  assert.deepEqual(db.connection.prepare('pragma foreign_key_check').all(), []);
});
