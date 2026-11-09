import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
const config = {
  enabled: true,
  url: 'http://localhost/hook',
  token: '',
  condition: 'all',
  scanFailures: true,
};
function fixture(t) {
  const dir = mkdtempSync(tmpdir() + '/notify-templates-');
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, repo: new NotificationRepository(db) };
}
test('templates independently enable, deduplicate, isolate and cancel only their own pending jobs', (t) => {
  const { repo } = fixture(t);
  const a = repo.createTemplate('a', { ...config, name: 'First' });
  const b = repo.createTemplate('a', { ...config, name: 'Second' });
  assert.equal(repo.listTemplates('a').length, 2);
  assert.equal(repo.listTemplates('b').length, 0);
  assert.throws(() => repo.getTemplate('b', a.id));
  const task = { id: 'task', name: 'Backup', ownerUid: 'a', type: 'script' };
  const run = {
    id: 'run',
    status: 'failed',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  repo.taskResult(task, run);
  repo.taskResult(task, run);
  assert.equal(repo.deliveries('a').total, 2);
  repo.setTemplateEnabled('a', a.id, false);
  assert.equal(repo.deliveries('a').items.filter((x) => x.status === 'cancelled').length, 1);
  const job = repo.claim();
  assert.equal(job.templateId, b.id);
  repo.finish(job, 200, false);
  repo.deleteTemplate('a', b.id);
  assert.equal(repo.deliveries('a').total, 2);
  assert.equal(repo.listTemplates('a').length, 1);
});
test('template updates are scoped and reject conflicting names and invalid SMTP input', (t) => {
  const { repo } = fixture(t);
  const a = repo.createTemplate('a', { ...config, name: 'One' });
  assert.throws(() => repo.createTemplate('a', { ...config, name: 'One' }));
  assert.throws(() => repo.updateTemplate('other', a.id, { ...config, name: 'Other' }));
  assert.throws(() =>
    repo.createTemplate('a', {
      ...config,
      name: 'Mail',
      channel: 'email',
      url: '',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      smtpUser: 'a',
      smtpFrom: 'bad\r\nBcc:steal@example.com',
      smtpTo: 'to@example.com',
    }),
  );
  const m = repo.createTemplate('a', {
    ...config,
    name: 'Mail',
    channel: 'email',
    url: '',
    token: 'SECRET',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpUser: 'from@example.com',
    smtpFrom: 'from@example.com',
    smtpTo: 'to@example.com',
  });
  assert.equal(m.channel, 'email');
  assert.equal(repo.getTemplate('a', m.id).token, 'SECRET');
});
test('schema30 notification settings and pending history migrate once into an enabled default template', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { schema } = await import('../server/persistence/schema.js');
  const { legacyNotificationSchema } = await import('./fixtures/notification-schema.js');
  const dir = mkdtempSync(tmpdir() + '/notify-template-migrate-');
  const raw = new DatabaseSync(dir + '/nas-manager.sqlite');
  raw.exec(legacyNotificationSchema(schema));
  raw
    .prepare('INSERT INTO notification_settings VALUES(?,?,?,?,?,?,?)')
    .run('owner', 1, 'https://local/hook', 'PRIVATE', 'all', 1, 4);
  raw
    .prepare('INSERT INTO notification_options VALUES(?,?)')
    .run(
      'owner',
      JSON.stringify({
        channel: 'slack',
        headers: { 'x-key': 'SECRET' },
        template: '{{name}}',
        signingSecret: '',
        telegramChatId: '',
      }),
    );
  raw
    .prepare(
      "INSERT INTO notification_deliveries(id,owner_uid,event_id,event_type,name,payload,revision,status,created_at,next_attempt_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)",
    )
    .run(
      'pending',
      'owner',
      'run',
      'task.result',
      'Backup',
      '{"name":"Backup","status":"failed"}',
      4,
      1,
      1,
    );
  raw.close();
  let db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let repo = new NotificationRepository(db);
  const s = repo.getTemplate('owner', 'default');
  assert.equal(s.enabled, true);
  assert.equal(s.token, 'PRIVATE');
  assert.equal(s.channel, 'slack');
  assert.equal(s.headers['x-key'], 'SECRET');
  assert.equal(repo.listTemplates('owner').length, 1);
  assert.equal(repo.claim().templateId, 'default');
  assert.equal(
    db.connection
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE name IN ('notification_settings','notification_options')",
      )
      .get().n,
    0,
  );
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
  db = new DatabaseService(dir);
  repo = new NotificationRepository(db);
  assert.equal(repo.listTemplates('owner').length, 1);
});
