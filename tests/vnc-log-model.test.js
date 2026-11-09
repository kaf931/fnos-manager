import test from 'node:test';
import assert from 'node:assert/strict';
import { createVncLog, authenticationLabel } from '../.web-test/vnc-log-model.js';
test('VNC client logs are bounded, redact credentials and merge backend snapshots once', () => {
  let now = 1000;
  const log = createVncLog(() => now, 3);
  log.protect(['my-secret']);
  log.add('auth', 'error', 'password=my-secret\u001b[31m ticket=abcdef');
  assert.doesNotMatch(log.items()[0].message, /my-secret|abcdef|\u001b/);
  const rows = [
    {
      id: 1,
      time: new Date(now).toISOString(),
      elapsedMs: 5,
      stage: 'network',
      level: 'success',
      message: 'TCP 连接成功',
    },
  ];
  log.merge('s', rows);
  log.merge('s', rows);
  assert.equal(log.items().length, 2);
  const epoch = log.epoch;
  log.clear();
  log.merge('s', rows);
  assert.equal(log.items().length, 0);
  log.merge('s', [{ ...rows[0], id: 2 }], epoch);
  assert.equal(log.items().length, 0);
  log.merge('s', [{ ...rows[0], id: 2 }]);
  assert.equal(log.items().length, 0);
  for (let i = 0; i < 5; i++) {
    now++;
    log.add('session', 'info', '新连接');
  }
  assert.equal(log.items().length, 3);
  assert.match(log.text(), /客户端/);
  assert.match(authenticationLabel(2), /VNC 密码/);
  assert.match(authenticationLabel(30), /Apple/);
});
