import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
import { NotificationService } from '../server/notifications/service.js';
import { RetentionRepository } from '../server/persistence/retention.repository.js';
import {
  prepareNotification,
  notificationAcknowledgement,
} from '../server/notifications/channels.js';
const payload = JSON.stringify({ name: 'Maintenance', status: 'failed' });
test('personal providers use native payloads, scoped secrets and business acknowledgements', () => {
  const bark = prepareNotification({
    channel: 'bark',
    url: 'https://local/push',
    token: 'KEY',
    payload,
  });
  assert.equal(JSON.parse(bark.body).device_key, 'KEY');
  assert.equal(bark.headers.authorization, undefined);
  for (const [key, url] of [
    ['SCT_test', 'https://sctapi.ftqq.com/SCT_test.send'],
    ['sctp123tKEY', 'https://123.push.ft07.com/send/sctp123tKEY.send'],
  ]) {
    const s = prepareNotification({ channel: 'serverchan', url: '', token: key, payload });
    assert.equal(s.url, url);
    assert.match(JSON.parse(s.body).desp, /失败/);
  }
  assert.equal(notificationAcknowledgement('bark', '{"code":200}').error, undefined);
  assert.equal(notificationAcknowledgement('serverchan', '{"code":0}').error, undefined);
  assert.ok(notificationAcknowledgement('serverchan', '{"code":0,"data":{"errno":1}}').error);
});
test('in-app delivery never makes network requests; inbox is isolated, readable, bounded and cleaned with deliveries', async (t) => {
  const dir = mkdtempSync(tmpdir() + '/inbox-'),
    db = new DatabaseService(dir),
    repo = new NotificationRepository(db);
  let sent = 0;
  const service = new NotificationService(repo, async () => {
    sent++;
    return 200;
  });
  t.after(async () => {
    await service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const template = repo.createTemplate('a', {
    channel: 'inapp',
    name: 'App',
    enabled: true,
    url: '',
    token: '',
    condition: 'all',
    scanFailures: true,
    template: '{{name}} {{statusText}}',
  });
  const first = repo.enqueueTest('a', template.id);
  await service.tick();
  assert.equal(sent, 0);
  assert.equal(repo.inboxUnread('a'), 1);
  assert.equal(repo.inboxUnread('b'), 0);
  const page = repo.inbox('a', 1, 10, 'unread');
  assert.equal(page.total, 1);
  assert.match(page.items[0].content, /通知测试 测试/);
  assert.throws(() => repo.readInbox('b', [first.id]), /不存在/);
  assert.equal(repo.inboxUnread('a'), 1);
  repo.readInbox('a', [first.id]);
  assert.equal(repo.inboxUnread('a'), 0);
  assert.equal(repo.inbox('a', 1, 10, 'unread').total, 0);
  const limits = new RetentionRepository(db);
  limits.save({ ...limits.limits(), deliveries: 1 });
  repo.enqueueTest('a', template.id);
  await service.tick();
  assert.equal(repo.inbox('a', 1, 10, 'all').total, 1);
  limits.clear('deliveries', 'a');
  assert.equal(repo.inboxUnread('a'), 0);
});

test('schema32 upgrades once without changing existing templates or delivery metadata', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const { schema } = await import('../server/persistence/schema.js');
  const { beforeInboxSchema } = await import('./fixtures/notification-schema.js');
  const dir = mkdtempSync(tmpdir() + '/inbox-migrate-');
  const raw = new DatabaseSync(dir + '/nas-manager.sqlite');
  raw.exec(beforeInboxSchema(schema));
  const config = JSON.stringify({
    channel: 'webhook',
    enabled: false,
    url: 'http://localhost/hook',
    token: 'PRIVATE',
  });
  raw
    .prepare(
      'INSERT INTO notification_templates(id,owner_uid,name,config,revision,created_at,updated_at) VALUES(?,?,?,?,1,1,1)',
    )
    .run('keep', 'owner', 'Keep', config);
  raw.close();
  let db = new DatabaseService(dir);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 33);
  assert.equal(
    db.connection.prepare('SELECT config FROM notification_templates').get().config,
    config,
  );
  db.close();
  db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(
    db.connection.prepare('SELECT count(*) n FROM schema_migrations WHERE version=33').get().n,
    1,
  );
});

test('inbox search matches title and content literally and delivery filters remain owner scoped', (t) => {
  const dir = mkdtempSync(tmpdir() + '/inbox-search-'),
    db = new DatabaseService(dir),
    repo = new NotificationRepository(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const template = repo.createTemplate('a', {
    channel: 'inapp',
    name: 'Search',
    enabled: true,
    url: '',
    token: '',
    condition: 'all',
    scanFailures: true,
    template: 'Unique body 100%',
  });
  const first = repo.enqueueTest('a', template.id);
  const job = repo.claim();
  repo.finish(job, 204, false);
  assert.equal(repo.inbox('a', 1, 10, 'all', 'Unique body').total, 1);
  assert.equal(repo.inbox('a', 1, 10, 'all', '100%').total, 1);
  assert.equal(repo.inbox('a', 1, 10, 'all', 'absent').total, 0);
  assert.equal(repo.inbox('b', 1, 10, 'all', 'Unique').total, 0);
  assert.throws(() => repo.inbox('a', 1, 10, 'all', 'x'.repeat(201)));
  assert.equal(repo.deliveries('a', 1, 10, { templateId: template.id }).items[0].id, first.id);
  assert.equal(repo.deliveries('b', 1, 10, { templateId: template.id }).total, 0);
  assert.equal(repo.deliveries('a', 1, 10, { reminderId: 'missing' }).total, 0);
});
