import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUi, tick } from './fixtures/react-ui.js';
const device = (id) => ({
  name: 'PC ' + id,
  ip: '192.168.1.' + id,
  mac: '02:00:00:00:00:0' + id,
  address: '192.168.1.255',
});
const defaults = { toast() {}, existing: [], onComplete: async () => {} };
const mountDiscovery = (t, props) =>
  mountUi(t, 'wake-discovery', 'WakeDiscovery', props, {
    'task-pagination': 'export function TaskPagination(){ return null; }',
  });
test('discovery loading remains mounted and ignores results after cancel', async (t) => {
  let resolve,
    calls = 0;
  const ui = await mountDiscovery(t, {
    ...defaults,
    api: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
  });
  assert.match(ui.get('[data-status]').textContent, /正在扫描/);
  assert.equal(calls, 1);
  ui.close();
  resolve({ networks: ['old'], devices: [device(1)] });
  await tick();
  assert.equal(ui.get('dialog'), null);
});
test('saved discoveries remain unavailable when refreshing fails and preserve host IP', async (t) => {
  const writes = [];
  const ui = await mountDiscovery(t, {
    ...defaults,
    api: async (route, method, body) =>
      route === '/wake/discover' ? { networks: [], devices: [device(1)] } : (writes.push(body), {}),
    onComplete: async () => {
      throw Error('refresh unavailable');
    },
  });
  assert.equal(ui.get('thead tr').firstElementChild.querySelector('input')?.type, 'checkbox');
  assert.equal(ui.get('tbody tr').firstElementChild.querySelector('input')?.type, 'checkbox');
  ui.click('thead input');
  ui.click('.dialog-footer .primary');
  await tick();
  await tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ip, '192.168.1.1');
  assert.equal(writes[0].address, '192.168.1.255');
  assert.match(ui.get('[role="alert"]').textContent, /refresh unavailable/);
  assert.equal(ui.get('tbody input').disabled, true);
});
test('unmount during addition prevents subsequent device writes', async (t) => {
  let finish,
    writes = 0;
  const ui = await mountDiscovery(t, {
    ...defaults,
    api: (route) =>
      route === '/wake/discover'
        ? Promise.resolve({ networks: [], devices: [device(1), device(2)] })
        : (++writes, new Promise((r) => (finish = r))),
  });
  ui.click('thead input');
  ui.click('.dialog-footer .primary');
  assert.equal(writes, 1);
  ui.close();
  finish({});
  await tick();
  assert.equal(writes, 1);
});
