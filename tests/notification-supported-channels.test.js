import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATION_CHANNELS, notificationReady } from '../server/domain/notifications.js';
import { validateNotificationOptions } from '../server/notifications/channels.js';

test('only five common notification channels are supported; removed providers cannot send', () => {
  assert.deepEqual(NOTIFICATION_CHANNELS, ['webhook', 'wecom', 'dingtalk', 'feishu', 'email']);
  for (const channel of [
    'telegram',
    'bark',
    'pushplus',
    'serverchan',
    'wxpusher',
    'ntfy',
    'gotify',
    'slack',
    'discord',
  ]) {
    assert.throws(() => validateNotificationOptions({ channel }), /通知渠道/);
    assert.equal(
      notificationReady({ channel, url: 'http://localhost/hook', token: 'secret' }),
      false,
    );
  }
});

test('retired saved channels stay stored but cannot enqueue or resume pending deliveries', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { NotificationRepository } =
    await import('../server/persistence/notification.repository.js');
  const dir = mkdtempSync(tmpdir() + '/retired-channel-');
  const db = new DatabaseService(dir),
    repo = new NotificationRepository(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const row = repo.createTemplate('owner', {
    name: 'Old',
    enabled: true,
    url: 'http://localhost/hook',
    token: 'old-secret',
    condition: 'all',
    scanFailures: true,
  });
  const delivery = repo.enqueueTest('owner', row.id);
  const stored = JSON.stringify({
    ...repo.getTemplate('owner', row.id),
    channel: 'retired',
    telegramChatId: 'old-id',
  });
  db.connection
    .prepare('UPDATE notification_templates SET config=? WHERE id=?')
    .run(stored, row.id);
  db.connection
    .prepare('UPDATE notification_deliveries SET channel=? WHERE id=?')
    .run('retired', delivery.id);
  assert.equal(repo.getTemplate('owner', row.id).enabled, false);
  assert.equal('telegramChatId' in repo.getTemplate('owner', row.id), false);
  assert.throws(() => repo.enqueueTest('owner', row.id), /完整的通知配置/);
  repo.recover();
  assert.equal(repo.claim(), undefined);
  assert.equal(repo.deliveries('owner').items[0].status, 'cancelled');
  assert.equal(
    db.connection.prepare('SELECT config FROM notification_templates WHERE id=?').get(row.id)
      .config,
    stored,
  );
});
