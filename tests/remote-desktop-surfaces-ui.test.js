import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi } from './fixtures/react-ui.js';

for (const connected of [true, false]) {
  test(`remote text input ${connected ? 'sends a complete line and clears the draft' : 'retains the draft without sending while disconnected'}`, async (t) => {
    const sent = [],
      changed = [];
    const ui = await mountUi(t, 'remote-desktop-surfaces', 'RemoteDesktopTextInput', {
      value: 'pwd',
      connected,
      onSend: (value) => sent.push(value),
      onChange: (value) => changed.push(value),
    });
    await act(() =>
      ui.get('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    assert.deepEqual(sent, connected ? ['pwd\n'] : []);
    assert.deepEqual(changed, connected ? [''] : []);
    assert.equal(ui.get('button').disabled, !connected);
  });
}

test('remote errors keep the centered surface instead of inheriting banner layout', async (t) => {
  const ui = await mountUi(t, 'remote-desktop-surfaces', 'RemoteDesktopStatus', {
    status: '连接失败',
    failure: true,
  });
  const status = ui.get('[role="alert"]');
  assert.ok(status.classList.contains('remote-desktop-status'));
  assert.ok(status.classList.contains('error'));
  assert.equal(
    status.classList.contains('notice'),
    false,
    'banner padding and bottom margin must not leak into the centered remote surface',
  );
  assert.match(status.textContent, /连接失败/);
});
