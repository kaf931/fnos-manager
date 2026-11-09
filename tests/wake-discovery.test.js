import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryNetworks, discoveryDevices, LanDiscovery } from '../server/wake-discovery.js';
const addresses = [
  { ifname: 'enp1s0-ovs', addr_info: [{ family: 'inet', local: '192.168.1.35', prefixlen: 24 }] },
  { ifname: 'docker0', addr_info: [{ family: 'inet', local: '172.17.0.1', prefixlen: 16 }] },
  { ifname: 'wlo1', addr_info: [{ family: 'inet', local: '192.168.1.32', prefixlen: 24 }] },
];
const routes = [{ dev: 'enp1s0-ovs' }, { dev: 'wlo1' }];
test('LAN discovery targets only bounded private default-route networks, deduplicating subnets', () => {
  const nets = discoveryNetworks(addresses, routes);
  assert.equal(nets.length, 1);
  assert.equal(nets[0].hosts.length, 254);
  assert.equal(nets[0].broadcast, '192.168.1.255');
  assert.deepEqual(
    discoveryNetworks(
      [{ ifname: 'tun0', addr_info: [{ family: 'inet', local: '10.0.0.1', prefixlen: 8 }] }],
      [{ dev: 'tun0' }],
    ),
    [],
  );
  assert.deepEqual(
    discoveryNetworks(
      [{ ifname: 'eth0', addr_info: [{ family: 'inet', local: '8.8.8.8', prefixlen: 24 }] }],
      [{ dev: 'eth0' }],
    ),
    [],
  );
});
test('discovered devices reject multicast, unresolved and off-subnet neighbors and deduplicate MACs', () => {
  const nets = discoveryNetworks(addresses, routes);
  const rows = discoveryDevices(
    [
      { dst: '192.168.1.2', dev: 'enp1s0-ovs', lladdr: '00:11:22:33:44:55', state: ['REACHABLE'] },
      { dst: '192.168.1.3', dev: 'enp1s0-ovs', lladdr: '01:11:22:33:44:55' },
      { dst: '10.0.0.2', dev: 'enp1s0-ovs', lladdr: '00:11:22:33:44:66' },
      { dst: '192.168.1.4', dev: 'enp1s0-ovs', lladdr: '00:11:22:33:44:55' },
      { dst: '192.168.1.5', dev: 'enp1s0-ovs', state: ['FAILED'] },
    ],
    nets,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mac, '00:11:22:33:44:55');
  assert.equal(rows[0].address, '192.168.1.255');
});
test('discovery deduplicates concurrent requests, limits ping concurrency and caches completed scans', async () => {
  let active = 0,
    max = 0,
    pings = 0;
  const run = async (_binary, args) => {
    if (args.includes('addr'))
      return JSON.stringify([
        { ifname: 'eth0', addr_info: [{ family: 'inet', local: '192.168.1.1', prefixlen: 30 }] },
      ]);
    if (args.includes('route')) return JSON.stringify([{ dev: 'eth0' }]);
    if (args.includes('neigh')) return '[]';
    active++;
    pings++;
    max = Math.max(max, active);
    await new Promise((r) => setImmediate(r));
    active--;
    return '';
  };
  const scan = new LanDiscovery(run);
  const [a, b] = await Promise.all([scan.scan(), scan.scan()]);
  assert.deepEqual(a, b);
  assert.equal(pings, 1);
  assert.ok(max <= 32);
  await scan.scan();
  assert.equal(pings, 1);
  scan.close();
});

test('bounded discovery uses the actual LAN broadcast instead of the limited probe subnet', () => {
  for (const [local, prefixlen, broadcast, count] of [
    ['10.20.30.40', 16, '10.20.255.255', 254],
    ['10.20.30.40', 8, '10.255.255.255', 254],
    ['192.168.1.130', 25, '192.168.1.255', 126],
  ]) {
    const [network] = discoveryNetworks(
      [{ ifname: 'eth0', addr_info: [{ family: 'inet', local, prefixlen }] }],
      [{ dev: 'eth0' }],
    );
    assert.equal(network.hosts.length, count);
    assert.equal(network.broadcast, broadcast);
    const [device] = discoveryDevices(
      [{ dev: 'eth0', dst: network.hosts[0], lladdr: '00:11:22:33:44:55' }],
      [network],
    );
    assert.equal(device.address, broadcast);
  }
});
