import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorPoller } from '../.web-test/terminal-monitor-model.js';
test('switching SSH targets clears summaries and rejects late previous-host responses', async () => {
  const requests = [],
    updates = [];
  const poller = createMonitorPoller({
    read: (id) => new Promise((resolve) => requests.push({ id, resolve })),
    update: (value) => updates.push(value),
    schedule: () => 1,
    cancel: () => {},
  });
  poller.select({ id: 'a', generation: 1, connected: true });
  poller.select({ id: 'b', generation: 1, connected: true });
  requests[0].resolve({ host: 'a' });
  await new Promise((r) => setImmediate(r));
  assert.equal(updates.at(-1).data, null);
  requests[1].resolve({ host: 'b' });
  await new Promise((r) => setImmediate(r));
  assert.equal(updates.at(-1).data.host, 'b');
  poller.select({ id: 'b', generation: 1, connected: false });
  assert.equal(updates.at(-1).data, null);
  poller.dispose();
});
test('trend history stays bounded, avoids duplicate samples and isolates hosts', async () => {
  const { createMonitorHistory } = await import('../.web-test/terminal-monitor-model.js');
  const history = createMonitorHistory(3);
  for (let i = 0; i < 5; i++)
    history.push('a', { sampledAt: i, cpu: { percent: i }, memory: { percent: 50 }, network: [] });
  assert.equal(history.push('a', { sampledAt: 4 }).length, 3);
  assert.deepEqual(
    history
      .push('b', { sampledAt: 6, cpu: { percent: 90 }, memory: { percent: 20 }, network: [] })
      .map((x) => x.cpu),
    [90],
  );
  assert.deepEqual(
    history
      .push('a', { sampledAt: 5, cpu: { percent: 5 }, memory: { percent: 50 }, network: [] })
      .map((x) => x.cpu),
    [3, 4, 5],
  );
});
test('trend window expires old samples and uses default-route interfaces without virtual double counts', async () => {
  const { createMonitorHistory } = await import('../.web-test/terminal-monitor-model.js');
  const h = createMonitorHistory();
  h.push('a', { sampledAt: 1, network: [] });
  const data = {
    sampledAt: 200000,
    cpu: {},
    memory: {},
    defaultInterfaces: ['eth0'],
    network: [
      { name: 'eth0', receiveRate: 100, transmitRate: 20 },
      { name: 'br0', receiveRate: 100, transmitRate: 20 },
    ],
  };
  const points = h.push('a', data);
  assert.equal(points.length, 1);
  assert.equal(points[0].receive, 100);
});
test('rail transfer summaries reuse selected-host rates and format compact numbers with units', async () => {
  const { networkRates, formatTransferRate } =
    await import('../.web-test/terminal-monitor-model.js');
  const rates = networkRates({
    defaultInterfaces: ['eth0'],
    network: [
      { name: 'eth0', transmitRate: 1536, receiveRate: 0 },
      { name: 'veth0', transmitRate: 9999, receiveRate: 9999 },
    ],
  });
  assert.deepEqual(rates, { transmit: 1536, receive: 0 });
  assert.deepEqual(formatTransferRate(rates.transmit), { value: '1.5', unit: 'KB/s' });
  assert.deepEqual(formatTransferRate(0), { value: '0', unit: 'B/s' });
  assert.deepEqual(formatTransferRate(null), { value: '—', unit: '' });
  assert.deepEqual(networkRates(null), { transmit: null, receive: null });
});
test('network filters retain fnOS default OVS and physical interfaces without container noise', async () => {
  const { filterMonitorNetworks } = await import('../.web-test/terminal-monitor-model.js');
  const data = {
    defaultInterfaces: ['enp1s0-ovs', 'wlo1'],
    network: [
      { name: 'lo', physical: false, state: 'unknown', addresses: ['127.0.0.1'] },
      { name: 'enp1s0', physical: true, state: 'up', addresses: [] },
      { name: 'enp2s0', physical: true, state: 'down', addresses: [] },
      { name: 'wlo1', physical: true, state: 'up', addresses: ['192.168.1.36'] },
      { name: 'enp1s0-ovs', physical: false, state: 'unknown', addresses: ['192.168.1.35'] },
      { name: 'docker0', physical: false, state: 'up', addresses: ['172.17.0.1'] },
      { name: 'br-123', physical: false, state: 'up', addresses: ['172.18.0.1'] },
      { name: 'veth123', physical: false, state: 'up', addresses: [] },
    ],
  };
  assert.deepEqual(
    filterMonitorNetworks(data).map((n) => n.name),
    ['wlo1', 'enp1s0-ovs'],
  );
  assert.deepEqual(
    filterMonitorNetworks(data, 'physical').map((n) => n.name),
    ['enp1s0', 'enp2s0', 'wlo1'],
  );
  assert.equal(filterMonitorNetworks(data, 'all').length, 8);
  assert.deepEqual(
    filterMonitorNetworks({
      network: [
        { name: 'eth0', addresses: ['10.0.0.1'] },
        { name: 'docker0', addresses: ['172.17.0.1'] },
      ],
    }).map((n) => n.name),
    ['eth0'],
  );
  assert.deepEqual(filterMonitorNetworks(null), []);
});

test('process ranking switches metric and direction without mutating samples', async () => {
  const { rankMonitorProcesses } = await import('../.web-test/terminal-monitor-model.js');
  const rows = Array.from({ length: 8 }, (_, i) => ({ pid: i + 1, cpu: i, memory: 8 - i }));
  assert.deepEqual(
    rankMonitorProcesses(rows).map((p) => p.pid),
    [8, 7, 6, 5, 4],
  );
  assert.deepEqual(
    rankMonitorProcesses(rows, 'memory').map((p) => p.pid),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    rankMonitorProcesses(rows, 'memory', false).map((p) => p.pid),
    [8, 7, 6, 5, 4],
  );
  assert.deepEqual(
    rows.map((p) => p.pid),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(rankMonitorProcesses(null), []);
});
