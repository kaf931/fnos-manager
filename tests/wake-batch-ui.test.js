import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUi, tick } from './fixtures/react-ui.js';
test('select all toggles capped batch off and power change resets selection', async (t) => {
  const ui = await mountUi(t, 'wake-batch', 'WakeBatch', {
    api: async () => ({}),
    toast() {},
    onComplete: async () => {},
    rows: Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      name: 'Device ' + i,
      mac: '00:11:22:33:44:55',
      address: '192.168.1.255',
      port: 9,
      connectionId: 'ssh',
    })),
    connections: [
      { id: 'ssh', kind: 'remote', hasCredentials: true, host: 'host', port: 22, username: 'root' },
    ],
  });
  assert.equal(ui.get('thead tr').firstElementChild.querySelector('input')?.type, 'checkbox');
  for (const row of document.querySelectorAll('tbody tr')) {
    assert.equal(row.firstElementChild.querySelector('input')?.type, 'checkbox');
  }
  ui.click('thead input');
  assert.equal(document.querySelectorAll('tbody input:checked').length, 50);
  assert.equal(ui.get('thead input').checked, true);
  ui.click('thead input');
  assert.equal(document.querySelectorAll('tbody input:checked').length, 0);
  const select = ui.get('select');
  select.value = 'reboot';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  ui.click('thead input');
  assert.equal(document.querySelectorAll('tbody input:checked').length, 10);
});
