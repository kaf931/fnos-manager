import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { NotificationRepository } from '../server/persistence/notification.repository.js';
import { NotificationService } from '../server/notifications/service.js';

test('saved HTTP templates deliver through the real worker and accept native provider acknowledgements', async (t) => {
  const received = [];
  const responses = {
    webhook: { ok: true },
    wecom: { errcode: 0 },
    dingtalk: { errcode: 0 },
    feishu: { code: 0 },
    bark: { code: 200 },
    serverchan: { code: 0, data: { errno: 0 } },
  };
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost'),
        channel = url.pathname.slice(1);
      received.push({ channel, body: JSON.parse(body), headers: req.headers, url });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responses[channel]));
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + receiver.address().port;
  const original = https.request;
  // Serverchan derives its HTTPS endpoint from SendKey. Intercept this test's
  // request to the local receiver; no fake credential is sent to a real provider.
  https.request = (url, options, callback) => {
    assert.equal(url.hostname, 'sctapi.ftqq.com');
    assert.equal(url.pathname, '/SCT_protocol_test.send');
    return http.request(origin + '/serverchan', options, callback);
  };
  const dir = mkdtempSync(tmpdir() + '/notify-delivery-matrix-'),
    db = new DatabaseService(dir),
    repo = new NotificationRepository(db),
    service = new NotificationService(repo);
  t.after(async () => {
    await service.close();
    https.request = original;
    await new Promise((resolve) => receiver.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const channel of Object.keys(responses)) {
    const template = repo.createTemplate('owner', {
      name: 'Protocol ' + channel,
      channel,
      enabled: true,
      url: channel === 'serverchan' ? '' : origin + '/' + channel,
      token:
        channel === 'serverchan'
          ? 'SCT_protocol_test'
          : channel === 'bark'
            ? 'test-device-key'
            : '',
      headers: { 'X-Template-Test': channel },
      condition: 'all',
      scanFailures: true,
      signingSecret: ['webhook', 'dingtalk', 'feishu'].includes(channel)
        ? 'local-test-signing-key'
        : '',
    });
    repo.enqueueTest('owner', template.id);
    await service.tick();
  }
  assert.equal(received.length, 6);
  for (const channel of Object.keys(responses))
    assert.ok(received.some((row) => row.channel === channel));
  assert.ok(received.every((row) => row.headers['x-template-test'] === row.channel));
  const wecom = received.find((row) => row.channel === 'wecom').body;
  assert.equal(wecom.msgtype, 'text');
  assert.match(wecom.text.content, /测试/);
  const ding = received.find((row) => row.channel === 'dingtalk');
  assert.ok(ding.url.searchParams.get('timestamp'));
  assert.ok(ding.url.searchParams.get('sign'));
  const feishu = received.find((row) => row.channel === 'feishu').body;
  assert.equal(feishu.msg_type, 'text');
  assert.ok(feishu.sign);
  assert.equal(received.find((row) => row.channel === 'bark').body.device_key, 'test-device-key');
  assert.match(received.find((row) => row.channel === 'serverchan').body.desp, /测试/);
  assert.ok(received.find((row) => row.channel === 'webhook').headers['x-nas-signature']);
  const records = repo.deliveries('owner');
  assert.equal(records.total, 6);
  assert.ok(records.items.every((row) => row.status === 'success' && row.attempts === 1));
  assert.equal(repo.deliveries('other').total, 0);
});
