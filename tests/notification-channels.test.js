import { legacyNotificationReset } from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  prepareNotification,
  notificationAcknowledgement,
  validateNotificationOptions,
} from '../server/notifications/channels.js';
const payload = JSON.stringify({
  eventId: 'one',
  eventType: 'task.result',
  name: 'A "quoted" task',
  status: 'failed',
  exitCode: 1,
});
const settings = {
  channel: 'webhook',
  headers: {},
  template: '',
  signingSecret: '',
};
test('all built-in channels encode their native text envelopes', () => {
  for (const channel of ['wecom', 'dingtalk', 'feishu']) {
    const request = prepareNotification(
      {
        url: 'https://example.test/hook',
        token: '123:ABC',
        payload,
        ...settings,
        channel,
      },
      1000000,
    );
    const body = JSON.parse(request.body);
    if (channel === 'feishu') {
      assert.equal(body.msg_type, 'text');
      assert.match(body.content.text, /失败/);
    } else {
      assert.equal(body.msgtype, 'text');
      assert.match(body.text.content, /失败/);
    }
  }
});
test('signatures follow distinct DingTalk, Feishu and generic protocols', () => {
  const secret = 'SEC-test';
  const now = 1700000000000;
  const ding = prepareNotification(
    {
      url: 'https://example.test/?sign=old',
      payload,
      ...settings,
      channel: 'dingtalk',
      signingSecret: secret,
    },
    now,
  );
  assert.equal(
    new URL(ding.url).searchParams.get('sign'),
    createHmac('sha256', secret).update(`${now}\n${secret}`).digest('base64'),
  );
  const feishu = JSON.parse(
    prepareNotification(
      {
        url: 'https://example.test',
        payload,
        ...settings,
        channel: 'feishu',
        signingSecret: secret,
      },
      now,
    ).body,
  );
  assert.equal(feishu.timestamp, '1700000000');
  assert.equal(
    feishu.sign,
    createHmac('sha256', `1700000000\n${secret}`).update('').digest('base64'),
  );
  const generic = prepareNotification(
    { url: 'https://example.test', payload, ...settings, signingSecret: secret },
    now,
  );
  assert.equal(generic.headers['x-nas-timestamp'], '1700000000');
  assert.equal(
    generic.headers['x-nas-signature'],
    'sha256=' + createHmac('sha256', secret).update(`1700000000.${generic.body}`).digest('hex'),
  );
});
test('templates preserve JSON quoting and reject unknown variables or unsafe headers', () => {
  const request = prepareNotification({
    url: 'http://local/hook',
    payload,
    ...settings,
    template: '{"message":"{{name}}: {{statusText}}","nested":["{{exitCode}}"]}',
  });
  assert.deepEqual(JSON.parse(request.body), { message: 'A "quoted" task: 失败', nested: ['1'] });
  for (const headers of [
    { Host: 'evil' },
    { 'X-Token': 'ok\r\ninjected' },
    { 'x-a': 'one', 'X-A': 'two' },
  ])
    assert.throws(() => validateNotificationOptions({ ...settings, headers }));
  assert.throws(() =>
    validateNotificationOptions({ ...settings, template: '{"x":"{{password}}"}' }),
  );
  assert.throws(() => validateNotificationOptions({ ...settings, template: 'invalid json' }));
});
test('provider acknowledgements never accept HTTP-only success and do not expose response secrets', () => {
  assert.equal(notificationAcknowledgement('webhook', '').error, undefined);
  assert.equal(notificationAcknowledgement('wecom', '{"errcode":0}').error, undefined);
  assert.equal(
    notificationAcknowledgement('dingtalk', '{"errcode":310000,"errmsg":"SECRET"}').error,
    '平台拒绝消息（310000）',
  );
  assert.equal(notificationAcknowledgement('feishu', '{"code":0}').error, undefined);
  for (const channel of ['wecom', 'dingtalk', 'feishu'])
    assert.ok(notificationAcknowledgement(channel, '{}').error);
});
test('platform transport records business failures at HTTP 200 and sends custom headers', async (t) => {
  const { createServer } = await import('node:http');
  const { sendNotification } = await import('../server/notifications/service.js');
  let received;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received = { body: JSON.parse(body), header: req.headers['x-api-key'] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"errcode":310000,"errmsg":"SECRET should never enter logs"}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await sendNotification(
    {
      url: `http://127.0.0.1:${server.address().port}/hook`,
      token: '',
      payload,
      options: { ...settings, channel: 'dingtalk', headers: { 'X-Api-Key': 'value' } },
    },
    new AbortController().signal,
  );
  assert.equal(result.httpStatus, 200);
  assert.equal(result.error, '平台拒绝消息（310000）');
  assert.equal(received.header, 'value');
  assert.equal(received.body.msgtype, 'text');
});
test('changed channel/template/header/signing settings cancel pending jobs and isolate owners', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { NotificationRepository } =
    await import('../server/persistence/notification.repository.js');
  const dir = mkdtempSync(tmpdir() + '/channel-settings-'),
    db = new DatabaseService(dir),
    repo = new NotificationRepository(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = {
    enabled: true,
    url: 'http://local/hook',
    token: '',
    condition: 'all',
    scanFailures: true,
  };
  repo.saveSettings('a', base);
  repo.enqueueTest('a');
  repo.saveSettings('a', {
    ...base,
    channel: 'dingtalk',
    signingSecret: 'SECRET',
    headers: { 'X-Key': 'PRIVATE' },
    template: '{{name}} {{statusText}}',
  });
  assert.equal(repo.deliveries('a').items[0].status, 'cancelled');
  repo.enqueueTest('a');
  const job = repo.claim();
  assert.equal(job.options.channel, 'dingtalk');
  assert.equal(job.options.signingSecret, 'SECRET');
  repo.finish(job, 200, false, Date.now(), '平台拒绝消息（310000）');
  assert.equal(repo.deliveries('a').items.find((item) => item.id === job.id)?.status, 'failed');
  assert.doesNotMatch(JSON.stringify(repo.deliveries('a')), /SECRET|PRIVATE/);
  assert.equal(repo.getSettings('b').signingSecret, '');
});
test('schema29 upgrades without changing existing settings, pending payloads or revision', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { NotificationRepository } =
    await import('../server/persistence/notification.repository.js');
  const dir = mkdtempSync(tmpdir() + '/channel-migrate-');
  let db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let repo = new NotificationRepository(db);
  repo.saveSettings('a', {
    enabled: true,
    url: 'http://local/hook',
    token: 'bearer',
    condition: 'errors',
    scanFailures: true,
  });
  repo.enqueueTest('a');
  const before = db.connection.prepare('SELECT * FROM notification_deliveries').get();
  db.connection.exec(
    legacyNotificationReset +
      'DROP TABLE notification_options;DELETE FROM schema_migrations WHERE version=30;PRAGMA user_version=29',
  );
  db.close();
  db = new DatabaseService(dir);
  repo = new NotificationRepository(db);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 33);
  assert.equal(repo.getSettings('a').channel, 'webhook');
  assert.equal(repo.getSettings('a').token, 'bearer');
  const after = db.connection.prepare('SELECT * FROM notification_deliveries').get();
  for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key]);
  assert.equal(repo.claim().options.channel, 'webhook');
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});
test('an event exceeding platform limits fails without HTTP or futile network retries', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { NotificationRepository } =
    await import('../server/persistence/notification.repository.js');
  const { NotificationService } = await import('../server/notifications/service.js');
  const dir = mkdtempSync(tmpdir() + '/channel-limit-'),
    db = new DatabaseService(dir),
    repo = new NotificationRepository(db),
    worker = new NotificationService(repo);
  t.after(async () => {
    await worker.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  repo.saveSettings('a', {
    enabled: true,
    url: 'http://127.0.0.1:1/hook',
    token: '',
    condition: 'all',
    scanFailures: true,
    channel: 'wecom',
    template: 'x'.repeat(1900) + '{{name}}',
  });
  repo.taskResult(
    { name: '长'.repeat(120), ownerUid: 'a', type: 'script' },
    { id: 'long', status: 'failed' },
  );
  await worker.tick();
  const row = repo.deliveries('a').items[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1);
  assert.equal(row.httpStatus, null);
  assert.equal(row.nextAttemptAt, null);
  assert.match(row.error, /内容或配置无效/);
});
