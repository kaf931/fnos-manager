import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ChinaCalendar, parseCalendarYear } from '../server/notifications/china-calendar.js';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
import { ReminderRepository } from '../server/persistence/reminder.repository.js';
const data = {
  year: 2028,
  papers: ['https://www.gov.cn/test-calendar'],
  days: [{ date: '2028-01-01', name: '测试假期', isOffDay: true }],
};
test('calendar parser rejects bad sources, invalid dates, duplicate days and invalid types', () => {
  assert.deepEqual(parseCalendarYear(data, 2028), data);
  for (const input of [
    { ...data, papers: ['https://example.com/'] },
    { ...data, days: [] },
    { ...data, year: 2029 },
    { ...data, days: [{ ...data.days[0], date: '2028-02-31' }] },
    { ...data, days: [...data.days, ...data.days] },
    { ...data, days: [{ ...data.days[0], isOffDay: 'true' }] },
  ])
    assert.throws(() => parseCalendarYear(input, 2028));
});
test('calendar updates persist verified data and failed updates keep the usable cache', async (t) => {
  const dir = mkdtempSync(tmpdir() + '/china-calendar-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calendar = new ChinaCalendar(dir, async (year) => (year === 2028 ? data : null));
  assert.equal(await calendar.refresh(2028, true), true);
  assert.equal(calendar.matches('2028-01-01', 'cn-holiday'), true);
  assert.equal(new ChinaCalendar(dir).matches('2028-01-01', 'cn-holiday'), true);
  const saved = readFileSync(dir + '/reminder-calendars/2028.json', 'utf8');
  const invalid = new ChinaCalendar(dir, async () => ({ ...data, days: [] }));
  assert.equal(await invalid.refresh(2028, true), false);
  assert.equal(readFileSync(dir + '/reminder-calendars/2028.json', 'utf8'), saved);
  writeFileSync(dir + '/reminder-calendars/2026.json', 'invalid');
  assert.equal(new ChinaCalendar(dir).matches('2026-01-04', 'cn-workday'), true);
  await Promise.all([calendar.close(), invalid.close()]);
});
test('closing a calendar aborts refresh without publishing partial data', async (t) => {
  const dir = mkdtempSync(tmpdir() + '/calendar-close-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let release;
  const calendar = new ChinaCalendar(
    dir,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const work = calendar.refresh(2028, true);
  const close = calendar.close();
  release(data);
  await close;
  assert.equal(await work, false);
  assert.throws(() => calendar.matches('2028-01-01', 'cn-holiday'));
});
test('a due holiday reminder waits for missing next-year data and resumes without duplicate delivery', async (t) => {
  const dir = mkdtempSync(tmpdir() + '/calendar-reminder-');
  const db = new DatabaseService(dir);
  const calendar = new ChinaCalendar(dir, async (year) => (year === 2028 ? data : null));
  t.after(async () => {
    await calendar.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const notifications = new NotificationRepository(db),
    repo = new ReminderRepository(db, notifications, calendar);
  const template = notifications.createTemplate('a', {
    name: 'Inbox',
    channel: 'inapp',
    url: '',
    token: '',
    enabled: true,
    condition: 'all',
    scanFailures: true,
  });
  const now = Date.parse('2027-10-06T01:00:00Z'),
    due = Date.parse('2027-10-07T01:00:00Z');
  const reminder = repo.create(
    'a',
    {
      name: '假期提醒',
      content: '',
      dueAt: new Date(due).toISOString(),
      repeat: 'cn-holiday',
      templateIds: [template.id],
      enabled: true,
    },
    now,
  );
  assert.equal(repo.dispatchDue(due), 1);
  const waiting = repo.get('a', reminder.id);
  assert.equal(waiting.enabled, true);
  assert.equal(waiting.nextAt, null);
  assert.match(waiting.error, /2028.*日历/);
  assert.equal(repo.dispatchDue(due + 1000), 0);
  assert.equal(notifications.deliveries('a').total, 1);
  await calendar.refresh(2028, true);
  repo.refreshCalendarSchedules(due + 1000);
  assert.equal(repo.get('a', reminder.id).nextAt, '2028-01-01T01:00:00.000Z');
  assert.equal(repo.get('a', reminder.id).error, null);
  assert.equal(repo.dispatchDue(due + 2000), 0);
});

test('first holiday reminder can fetch a missing year even with no existing calendar reminders', async (t) => {
  const { NotificationService } = await import('../server/notifications/service.js');
  const dir = mkdtempSync(tmpdir() + '/first-calendar-'),
    db = new DatabaseService(dir);
  const calendar = new ChinaCalendar(dir, async (year) => (year === 2028 ? data : null));
  const notifications = new NotificationRepository(db),
    repo = new ReminderRepository(db, notifications, calendar);
  const service = new NotificationService(notifications, undefined, repo);
  t.after(async () => {
    await service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const template = notifications.createTemplate('a', {
    name: 'Inbox',
    channel: 'inapp',
    url: '',
    token: '',
    enabled: true,
    condition: 'all',
    scanFailures: true,
  });
  assert.equal(repo.hasCalendarReminders(), false);
  const result = await service.createReminder('a', {
    name: '首个日历提醒',
    content: '',
    dueAt: '2028-01-01T01:00:00Z',
    repeat: 'cn-holiday',
    templateIds: [template.id],
    enabled: true,
  });
  assert.equal(result.nextAt, '2028-01-01T01:00:00.000Z');
});
