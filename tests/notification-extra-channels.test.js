import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareNotification,
  notificationAcknowledgement,
} from '../server/notifications/channels.js';
import { DEFAULT_NOTIFICATION_OPTIONS, notificationReady } from '../server/domain/notifications.js';
const payload = JSON.stringify({
  name: 'Night backup',
  status: 'success',
  eventId: 'one',
  eventType: 'task.result',
});
const input = (channel, extra = {}) => ({
  ...DEFAULT_NOTIFICATION_OPTIONS,
  channel,
  url: 'https://notify.example/push',
  token: 'TEST_KEY',
  payload,
  topic: 'nas-alerts',
  ...extra,
});
test('eight new providers generate native payloads and credentials without bearer leakage', () => {
  const bark = prepareNotification(input('bark'));
  assert.equal(JSON.parse(bark.body).device_key, 'TEST_KEY');
  assert.equal(bark.headers.authorization, undefined);
  const plus = prepareNotification(input('pushplus'));
  assert.equal(plus.url, 'https://www.pushplus.plus/send');
  assert.equal(JSON.parse(plus.body).token, 'TEST_KEY');
  assert.equal(JSON.parse(plus.body).topic, 'nas-alerts');
  assert.equal(JSON.parse(plus.body).template, 'txt');
  const sct = prepareNotification(input('serverchan', { token: 'SCT_test' }));
  assert.equal(sct.url, 'https://sctapi.ftqq.com/SCT_test.send');
  assert.match(JSON.parse(sct.body).desp, /成功/);
  const sc3 = prepareNotification(input('serverchan', { token: 'sctp123tTEST' }));
  assert.equal(sc3.url, 'https://123.push.ft07.com/send/sctp123tTEST.send');
  const wx = prepareNotification(input('wxpusher', { token: 'SPT_TEST' }));
  assert.match(wx.url, /simple-push$/);
  assert.equal(JSON.parse(wx.body).spt, 'SPT_TEST');
  const standard = prepareNotification(
    input('wxpusher', { token: 'AT_TEST', recipients: 'UID_one, UID_two' }),
  );
  assert.deepEqual(JSON.parse(standard.body).uids, ['UID_one', 'UID_two']);
  const ntfy = prepareNotification(input('ntfy'));
  assert.equal(JSON.parse(ntfy.body).topic, 'nas-alerts');
  assert.equal(ntfy.headers.authorization, 'Bearer TEST_KEY');
  const gotify = prepareNotification(input('gotify'));
  assert.equal(gotify.headers['x-gotify-key'], 'TEST_KEY');
  assert.equal(gotify.headers.authorization, undefined);
  assert.equal(JSON.parse(gotify.body).priority, 5);
  const slack = prepareNotification(input('slack', { token: '' }));
  assert.equal(JSON.parse(slack.body).blocks[0].text.type, 'plain_text');
  const discord = prepareNotification(input('discord', { token: '' }));
  assert.equal(new URL(discord.url).searchParams.get('wait'), 'true');
  assert.deepEqual(JSON.parse(discord.body).allowed_mentions, { parse: [] });
});
test('platform confirmations require their documented success and never echo secret responses', () => {
  const bodies = {
    bark: { code: 200 },
    pushplus: { code: 200 },
    serverchan: { code: 0 },
    wxpusher: { code: 1000, data: [{ code: 1000 }] },
    ntfy: { id: 'one', event: 'message' },
    gotify: { id: 1, message: 'ok' },
    discord: { id: '1234' },
  };
  for (const [channel, body] of Object.entries(bodies)) {
    assert.equal(notificationAcknowledgement(channel, JSON.stringify(body)).error, undefined);
    assert.ok(notificationAcknowledgement(channel, '{}').error);
    assert.ok(notificationAcknowledgement(channel, '{"error":"SECRET"}').error);
    assert.doesNotMatch(
      JSON.stringify(notificationAcknowledgement(channel, '{"error":"SECRET"}')),
      /SECRET/,
    );
  }
  assert.equal(notificationAcknowledgement('slack', 'ok\n').error, undefined);
  assert.ok(notificationAcknowledgement('slack', 'not_ok SECRET').error);
  assert.ok(notificationAcknowledgement('wxpusher', '{"code":1000,"data":[{"code":1001}]}').error);
  assert.ok(notificationAcknowledgement('serverchan', '{"code":0,"data":{"errno":1}}').error);
});
test('required fields reflect each channel rather than treating a URL as sufficient', () => {
  const base = {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    url: '',
    token: '',
    enabled: false,
    condition: 'all',
    scanFailures: true,
  };
  assert.equal(notificationReady({ ...base, channel: 'pushplus', token: 'TOKEN' }), true);
  assert.equal(notificationReady({ ...base, channel: 'ntfy', url: 'https://ntfy.sh' }), false);
  assert.equal(
    notificationReady({ ...base, channel: 'ntfy', url: 'https://ntfy.sh', topic: 'nas' }),
    true,
  );
  assert.equal(
    notificationReady({ ...base, channel: 'gotify', url: 'http://gotify/message' }),
    false,
  );
  assert.equal(notificationReady({ ...base, channel: 'wxpusher', token: 'AT_TEST' }), false);
  assert.equal(notificationReady({ ...base, channel: 'wxpusher', token: 'SPT_TEST' }), true);
});
test('all new channel configurations round-trip and older JSON options acquire defaults', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { NotificationRepository } =
    await import('../server/persistence/notification.repository.js');
  const dir = mkdtempSync(tmpdir() + '/extra-notify-'),
    db = new DatabaseService(dir),
    repo = new NotificationRepository(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const configs = {
    bark: { url: 'http://local/push', token: 'KEY' },
    pushplus: { url: '', token: 'KEY' },
    serverchan: { url: '', token: 'sctp123tTEST' },
    wxpusher: { url: '', token: 'AT_TEST', recipients: 'UID_one' },
    ntfy: { url: 'http://local/', token: '', topic: 'nas' },
    gotify: { url: 'http://local/message', token: 'KEY' },
    slack: { url: 'http://local/hook', token: '' },
    discord: { url: 'http://local/hook', token: '' },
  };
  for (const [channel, extra] of Object.entries(configs)) {
    const config = {
      enabled: true,
      url: '',
      token: '',
      condition: 'all',
      scanFailures: true,
      channel,
      ...extra,
    };
    const saved = repo.saveSettings(channel, config);
    assert.equal(saved.channel, channel);
    repo.enqueueTest(channel);
    const job = repo.claim();
    assert.equal(job.owner, channel);
    assert.equal(job.options.channel, channel);
    repo.finish(job, 200, false);
  }
  assert.throws(() =>
    repo.saveSettings('bad', {
      enabled: true,
      url: 'https://ntfy.sh/',
      token: '',
      condition: 'all',
      scanFailures: true,
      channel: 'ntfy',
    }),
  );
  assert.throws(() =>
    repo.saveSettings('bad', {
      enabled: true,
      url: '',
      token: 'AT_TEST',
      condition: 'all',
      scanFailures: true,
      channel: 'wxpusher',
    }),
  );
  db.connection
    .prepare("UPDATE notification_templates SET config=? WHERE owner_uid=? AND id='default'")
    .run(
      '{"channel":"slack","headers":{},"template":"","signingSecret":"","telegramChatId":""}',
      'slack',
    );
  assert.equal(repo.getSettings('slack').topic, '');
  assert.equal(repo.getSettings('slack').recipients, '');
});
test('HTTP adapters preserve JSON and authenticate against a local receiving service', async (t) => {
  const { createServer } = await import('node:http');
  const { sendNotification } = await import('../server/notifications/service.js');
  const replies = {
    bark: '{"code":200}',
    ntfy: '{"id":"one","event":"message"}',
    gotify: '{"id":1,"message":"ok"}',
    slack: 'ok',
    discord: '{"id":"123"}',
  };
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const channel = req.url.split('?')[0].slice(1);
      received.push({ channel, url: req.url, body: JSON.parse(body), headers: req.headers });
      res.end(replies[channel]);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const channel of Object.keys(replies)) {
    const result = await sendNotification(
      {
        url: `http://127.0.0.1:${server.address().port}/${channel}`,
        token: channel === 'slack' || channel === 'discord' ? '' : 'KEY',
        payload,
        options: { ...DEFAULT_NOTIFICATION_OPTIONS, channel, topic: 'nas' },
      },
      new AbortController().signal,
    );
    assert.equal(result.error, undefined);
    assert.equal(result.httpStatus, 200);
  }
  assert.equal(received.length, 5);
  assert.equal(received.find((x) => x.channel === 'gotify').headers['x-gotify-key'], 'KEY');
  assert.match(received.find((x) => x.channel === 'discord').url, /wait=true/);
});
