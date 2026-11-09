import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScreenControl } from '../server/adb/screencast-protocol.js';
import { dispatchScreenAction } from '../server/adb/screencast-actions.js';

test('device actions use dedicated scrcpy controls and display power never sends sleep', async () => {
  const calls = [];
  const controller = Object.fromEntries(
    ['setScreenPowerMode', 'rotateDevice'].map((method) => [
      method,
      async (...args) => calls.push([method, ...args]),
    ]),
  );
  for (const action of ['display-off', 'display-on', 'rotate']) {
    assert.deepEqual(validateScreenControl({ type: 'action', action, serial: 'ignored' }), {
      type: 'action',
      action,
    });
    await dispatchScreenAction(controller, action);
  }
  assert.deepEqual(calls, [['setScreenPowerMode', 0], ['setScreenPowerMode', 2], ['rotateDevice']]);
});
test('action channel rejects arbitrary commands, invalid types and inherited names', () => {
  for (const action of [
    'notifications',
    'quick-settings',
    'collapse-panels',
    'reboot',
    'shell',
    'constructor',
    'toString',
    '',
    null,
    1,
    {},
    ['rotate'],
  ])
    assert.throws(() => validateScreenControl({ type: 'action', action }));
});
test('device action rejection propagates to the existing session error handler', async () => {
  await assert.rejects(
    dispatchScreenAction(
      {
        rotateDevice: async () => {
          throw new Error('device rejected rotation');
        },
      },
      'rotate',
    ),
    /device rejected rotation/,
  );
});
