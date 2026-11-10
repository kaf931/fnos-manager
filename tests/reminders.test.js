import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
import { ReminderRepository } from '../server/persistence/reminder.repository.js';
import { nextReminderAt } from '../server/notifications/reminder-schedule.js';
const at = (s) => +new Date(s);
const now = at('2026-11-09T01:00:00Z');
function fixture(t) {
  const dir = mkdtempSync(tmpdir() + '/reminder-');
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const notifications = new NotificationRepository(db);
  const template = notifications.createTemplate('a', {
    name: 'Inbox',
    enabled: true,
    url: 'http://localhost/hook',
    token: '',
    condition: 'errors',
    scanFailures: false,
  });
  return { db, notifications, repo: new ReminderRepository(db, notifications), template };
}
const input = (id, extra = {}) => ({
  name: 'Renew',
  content: 'Check subscription',
  dueAt: new Date(now + 60000).toISOString(),
  repeat: 'none',
  templateIds: [id],
  enabled: true,
  ...extra,
});
test('reminder recurrence preserves Beijing wall time and original month-end anchor', () => {
  assert.equal(
    nextReminderAt('2026-01-31T01:00:00Z', 'monthly', at('2026-02-01T00:00:00Z')),
    '2026-02-28T01:00:00.000Z',
  );
  assert.equal(
    nextReminderAt('2026-01-31T01:00:00Z', 'monthly', at('2026-02-28T01:00:00Z')),
    '2026-03-31T01:00:00.000Z',
  );
  assert.equal(nextReminderAt('2026-11-09T01:00:00Z', 'daily', now), '2026-11-10T01:00:00.000Z');
  assert.equal(nextReminderAt('2026-11-09T01:00:00Z', 'weekly', now), '2026-11-16T01:00:00.000Z');
  assert.equal(nextReminderAt('2026-11-09T01:00:00Z', 'none', now), null);
});
test('required schedule, owner isolation, multi-template outbox, due deduplication and restart catch-up', (t) => {
  const { repo, notifications, template } = fixture(t);
  const note = repo.create('a', input(template.id, { enabled: false }), now);
  assert.equal(note.nextAt, null);
  assert.throws(() => repo.get('b', note.id));
  const second = notifications.createTemplate('a', {
    name: 'Second',
    enabled: true,
    url: 'http://localhost/other',
    token: '',
    condition: 'all',
    scanFailures: false,
  });
  const r = repo.create(
    'a',
    input(template.id, { repeat: 'daily', templateIds: [template.id, second.id] }),
    now,
  );
  assert.equal(repo.dispatchDue(now + 59000), 0);
  assert.equal(repo.dispatchDue(now + 8 * 86400000), 1);
  assert.equal(repo.dispatchDue(now + 8 * 86400000), 0);
  assert.equal(notifications.deliveries('a').total, 2);
  assert.equal(repo.get('a', r.id).nextAt, '2026-11-17T01:01:00.000Z');
  const job = notifications.claim(now + 8 * 86400000);
  assert.equal(JSON.parse(job.payload).content, 'Check subscription');
  assert.equal(JSON.parse(job.payload).eventType, 'reminder.due');
});
test('pause, completion and deletion only cancel the source reminder pending deliveries', (t) => {
  const { repo, notifications, template } = fixture(t);
  const a = repo.create('a', input(template.id), now),
    b = repo.create('a', input(template.id, { name: 'Other' }), now);
  repo.dispatchDue(now + 60001);
  repo.complete('a', a.id, true, now + 60002);
  assert.equal(
    notifications.deliveries('a').items.filter((r) => r.status === 'cancelled').length,
    1,
  );
  assert.equal(repo.get('a', a.id).status, 'completed');
  repo.complete('a', a.id, false, now + 60003);
  assert.equal(repo.get('a', a.id).enabled, false);
  repo.remove('a', b.id);
  assert.equal(
    notifications.deliveries('a').items.filter((r) => r.status === 'cancelled').length,
    2,
  );
});
test('enabled reminders require valid times and owned active templates; used templates stay protected', (t) => {
  const { repo, notifications, template } = fixture(t);
  assert.throws(() => repo.create('a', input('missing'), now));
  assert.throws(() => repo.create('b', input(template.id), now));
  assert.throws(() => repo.create('a', input(template.id, { dueAt: null }), now));
  assert.throws(() =>
    repo.create('a', input(template.id, { dueAt: new Date(now - 1000).toISOString() }), now),
  );
  const r = repo.create('a', input(template.id), now);
  assert.throws(() => notifications.setTemplateEnabled('a', template.id, false));
  assert.throws(() => notifications.deleteTemplate('a', template.id));
  repo.setEnabled('a', r.id, false, now);
  notifications.setTemplateEnabled('a', template.id, false);
  assert.throws(() => repo.setEnabled('a', r.id, true, now));
});
test('in-flight reminder failure cannot retry after the reminder is paused', (t) => {
  const { repo, notifications, template } = fixture(t);
  const r = repo.create('a', input(template.id), now);
  repo.dispatchDue(now + 60000);
  const job = notifications.claim(now + 60001);
  assert.ok(job);
  repo.complete('a', r.id, true, now + 60002);
  notifications.finish(job, 503, true, now + 60003);
  assert.equal(notifications.deliveries('a').items[0].status, 'cancelled');
});
test('reminder input rejects normalized invalid calendar dates', (t) => {
  const { repo, template } = fixture(t);
  assert.throws(() =>
    repo.create('a', input(template.id, { dueAt: '2026-02-30T01:00:00Z', enabled: false }), now),
  );
});
test('schema31 upgrade preserves template configuration and delivery metadata', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { schema } = await import('../server/persistence/schema.js');
  const { beforeRemindersSchema } = await import('./fixtures/notification-schema.js');
  const dir = mkdtempSync(tmpdir() + '/reminders-migrate-');
  const raw = new DatabaseSync(dir + '/nas-manager.sqlite');
  raw.exec(beforeRemindersSchema(schema));
  const cfg = JSON.stringify({
    enabled: false,
    url: 'http://local',
    token: 'PRIVATE',
    condition: 'errors',
    scanFailures: true,
  });
  raw
    .prepare('INSERT INTO notification_templates VALUES(?,?,?,?,1,1,1)')
    .run('keep', 'a', 'Keep', cfg);
  raw
    .prepare(
      "INSERT INTO notification_deliveries(id,owner_uid,template_id,template_name,channel,event_id,event_type,name,payload,revision,status,created_at) VALUES('keep','a','keep','Keep','webhook','event','test','Keep','{}',1,'success',1)",
    )
    .run();
  const before = raw.prepare('SELECT * FROM notification_deliveries').get();
  raw.close();
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(
    db.connection.prepare('SELECT config FROM notification_templates').get().config,
    cfg,
  );
  const after = db.connection.prepare('SELECT * FROM notification_deliveries').get();
  for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key]);
  assert.equal(after.read_at, null);
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});
test('editing a historically postponed one-off reminder keeps its stored deadline', (t) => {
  const { repo, template, db } = fixture(t);
  const r = repo.create('a', input(template.id), now);
  repo.dispatchDue(now + 60001);
  db.connection
    .prepare('UPDATE reminders SET next_at=?,enabled=1 WHERE id=?')
    .run(now + 1020000, r.id);
  const postponed = repo.get('a', r.id);
  const edited = repo.update(
    'a',
    r.id,
    {
      name: postponed.name,
      content: 'Changed note',
      dueAt: postponed.dueAt,
      repeat: postponed.repeat,
      templateIds: postponed.templateIds,
      enabled: true,
    },
    now + 180000,
  );
  assert.equal(edited.nextAt, postponed.nextAt);
  assert.equal(edited.content, 'Changed note');
});

test('saving even a paused reminder requires a time and an enabled ready template', (t) => {
  const { repo, notifications, template } = fixture(t);
  assert.throws(
    () => repo.create('a', input(template.id, { dueAt: null, enabled: false }), now),
    /提醒时间/,
  );
  assert.throws(
    () => repo.create('a', input(template.id, { templateIds: [], enabled: false }), now),
    /通知模板/,
  );
  notifications.setTemplateEnabled('a', template.id, false);
  assert.throws(() => repo.create('a', input(template.id, { enabled: false }), now), /通知模板/);
});

test('pausing a legacy reminder never requires its deleted template or missing schedule', (t) => {
  const { repo, db } = fixture(t);
  db.connection
    .prepare(
      "INSERT INTO reminders(id,owner_uid,name,content,due_at,repeat,template_ids,enabled,status,next_at,revision,created_at,updated_at) VALUES('legacy','a','Legacy','',NULL,'none','[\"deleted\"]',0,'open',?,1,?,?)",
    )
    .run(now + 60000, now, now);
  const paused = repo.setEnabled('a', 'legacy', false, now);
  assert.equal(paused.enabled, false);
  assert.equal(paused.nextAt, null);
  assert.throws(() => repo.setEnabled('b', 'legacy', false, now));
  assert.throws(() => repo.setEnabled('a', 'legacy', true, now));
});

test('bulk reminders are owner scoped and atomic, and cancel pending deliveries', (t) => {
  const { repo, notifications, template } = fixture(t);
  const a = repo.create('a', input(template.id), now),
    b = repo.create('a', input(template.id, { name: 'Second' }), now);
  assert.throws(() => repo.batch('a', [a.id, 'missing'], 'delete', now));
  assert.equal(repo.list('a').length, 2);
  assert.throws(() => repo.batch('b', [a.id], 'complete', now));
  assert.throws(() => repo.batch('a', [a.id, a.id], 'pause', now));
  repo.dispatchDue(now + 60001);
  assert.equal(notifications.deliveries('a', 1, 10, { reminderId: a.id }).total, 1);
  assert.equal(repo.batch('a', [a.id, b.id], 'pause', now + 60002).count, 2);
  assert.ok(repo.list('a').every((row) => !row.enabled && row.nextAt === null));
  assert.ok(notifications.deliveries('a').items.every((row) => row.status === 'cancelled'));
  repo.batch('a', [a.id, b.id], 'complete', now + 60003);
  assert.ok(repo.list('a').every((row) => row.status === 'completed'));
  repo.batch('a', [a.id, b.id], 'delete', now + 60004);
  assert.equal(repo.list('a').length, 0);
});

test('re-enabling a paused reminder removes deleted templates and retains the available channel', (t) => {
  const { repo, notifications, template } = fixture(t);
  const second = notifications.createTemplate('a', {
    name: 'Removed',
    enabled: true,
    url: 'http://localhost/second',
    token: '',
    condition: 'all',
    scanFailures: false,
  });
  const reminder = repo.create(
    'a',
    input(template.id, { enabled: false, templateIds: [template.id, second.id] }),
    now,
  );
  notifications.deleteTemplate('a', second.id);
  const enabled = repo.setEnabled('a', reminder.id, true, now);
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.templateIds, [template.id]);
  assert.equal(enabled.nextAt, new Date(now + 60000).toISOString());
  assert.equal(repo.dispatchDue(now + 60001), 1);
  assert.equal(notifications.deliveries('a').total, 1);
});

test('re-enabling with no surviving templates gives an actionable error and preserves the paused reminder', (t) => {
  const { repo, notifications, template } = fixture(t);
  const reminder = repo.create('a', input(template.id, { enabled: false }), now);
  notifications.deleteTemplate('a', template.id);
  assert.throws(() => repo.setEnabled('a', reminder.id, true, now), /重新选择通知模板/);
  assert.deepEqual(repo.get('a', reminder.id), reminder);
});

test('reminder recovery retains existing disabled templates and never accepts foreign ids in normal edits', (t) => {
  const { repo, notifications, template } = fixture(t);
  const second = notifications.createTemplate('a', {
    name: 'Paused template',
    enabled: false,
    url: 'http://localhost/second',
    token: '',
    condition: 'all',
    scanFailures: false,
  });
  const reminder = repo.create(
    'a',
    input(template.id, { enabled: false, templateIds: [template.id, second.id] }),
    now,
  );
  assert.deepEqual(repo.setEnabled('a', reminder.id, true, now).templateIds, [
    template.id,
    second.id,
  ]);
  const foreign = notifications.createTemplate('b', {
    name: 'Foreign',
    enabled: true,
    url: 'http://localhost/foreign',
    token: '',
    condition: 'all',
    scanFailures: false,
  });
  assert.throws(() =>
    repo.update(
      'a',
      reminder.id,
      input(template.id, { templateIds: [template.id, foreign.id] }),
      now,
    ),
  );
});

test('custom weekday schedules filter the first date and retain Beijing time across weeks', () => {
  assert.equal(
    nextReminderAt('2026-11-10T01:30:00Z', 'custom', at('2026-11-09T00:00:00Z'), [1, 3]),
    '2026-11-11T01:30:00.000Z',
  );
  assert.equal(
    nextReminderAt('2026-11-09T01:30:00Z', 'custom', at('2026-11-09T01:30:00Z'), [1, 3]),
    '2026-11-11T01:30:00.000Z',
  );
  assert.equal(
    nextReminderAt('2026-11-09T01:30:00Z', 'custom', at('2026-11-14T01:30:00Z'), [0]),
    '2026-11-15T01:30:00.000Z',
  );
  assert.throws(() => nextReminderAt('2026-11-09T01:30:00Z', 'custom', now, []), /周几/);
});
test('China recurrence includes makeup workdays and excludes ordinary weekends from announced holidays', () => {
  assert.equal(
    nextReminderAt('2026-01-01T01:00:00Z', 'cn-workday', at('2025-12-31T01:00:00Z')),
    '2026-01-04T01:00:00.000Z',
  );
  assert.equal(
    nextReminderAt('2026-01-10T01:00:00Z', 'cn-holiday', at('2026-01-09T01:00:00Z')),
    '2026-02-15T01:00:00.000Z',
  );
  assert.equal(
    nextReminderAt('2026-12-31T01:00:00Z', 'cn-holiday', at('2026-12-30T01:00:00Z')),
    '2027-01-01T01:00:00.000Z',
  );
  assert.throws(
    () => nextReminderAt('2099-01-01T01:00:00Z', 'cn-workday', at('2098-12-31T00:00:00Z')),
    /2099.*日历/,
  );
});
test('custom weekdays persist, validate, survive pause and recompute when edited', (t) => {
  const { repo, template } = fixture(t);
  const r = repo.create('a', input(template.id, { repeat: 'custom', weekdays: [3, 1] }), now);
  assert.deepEqual(r.weekdays, [1, 3]);
  const changed = repo.update('a', r.id, { ...r, weekdays: [5] }, now);
  assert.equal(changed.nextAt, '2026-11-13T01:01:00.000Z');
  repo.setEnabled('a', r.id, false, now);
  assert.deepEqual(repo.setEnabled('a', r.id, true, now).weekdays, [5]);
  for (const weekdays of [[], [1, 1], [-1], [7], ['1'], [1.5]])
    assert.throws(() => repo.create('a', input(template.id, { repeat: 'custom', weekdays }), now));
  assert.throws(() =>
    repo.create('a', input(template.id, { repeat: 'daily', weekdays: [1] }), now),
  );
});

test('weekday summaries compact consecutive selections without hiding which days repeat', async () => {
  const { reminderRepeatLabel } = await import('../server/domain/reminders.js');
  assert.equal(reminderRepeatLabel({ repeat: 'custom', weekdays: [1, 2, 3, 4, 5] }), '周一至周五');
  assert.equal(
    reminderRepeatLabel({ repeat: 'custom', weekdays: [0, 1, 2, 3, 4, 5, 6] }),
    '周一至周日',
  );
  assert.equal(reminderRepeatLabel({ repeat: 'custom', weekdays: [1, 3, 5] }), '周一、周三、周五');
});
