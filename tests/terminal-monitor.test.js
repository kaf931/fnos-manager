import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { parseMonitor, SessionMonitor } from '../server/terminal/monitor.js';
const snapshot = (
  cpu = 'cpu  100 0 50 850 0 0 0 0',
  memory = 'MemTotal: 1000 kB\nMemAvailable: 250 kB',
) =>
  `${cpu}\n__MEM__\n${memory}\n__DISK__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda 100 40 60 40% /\n/dev/sdb 200 150 50 75% /volume1\ntmpfs 10 1 9 10% /run\n`;
test('monitor calculates CPU deltas, available memory and actual disk mounts', () => {
  const first = parseMonitor(snapshot());
  assert.equal(first.cpu.percent, null);
  const next = parseMonitor(snapshot('cpu  130 0 60 910 0 0 0 0'), first.cpu);
  assert.equal(next.cpu.percent, 40);
  assert.equal(next.memory.percent, 75);
  assert.equal(next.memory.total, 1024000);
  assert.equal(next.disks.length, 2);
  assert.equal(next.disks[1].mount, '/volume1');
  assert.equal(next.disk.percent, 63.3);
  assert.throws(() => parseMonitor('not linux'), /监控/);
});
test('monitor deduplicates reads and closes only its exec channel on cancellation', async () => {
  let calls = 0,
    channel;
  const client = {
    exec(command, callback) {
      calls++;
      assert.ok(command.includes('/proc/stat'));
      channel = new PassThrough();
      channel.stderr = new PassThrough();
      channel.close = () => channel.destroy();
      callback(null, channel);
    },
  };
  const monitor = new SessionMonitor(client);
  const a = monitor.read(),
    b = monitor.read();
  channel.end(snapshot());
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
  await monitor.read();
  assert.equal(calls, 1);
  monitor.close();
  await assert.rejects(monitor.read(), /连接/);
  const pending = new SessionMonitor(client);
  const read = pending.read();
  pending.close();
  await assert.rejects(read, /连接/);
  assert.equal(channel.destroyed, true);
});
test('disk monitoring includes ZFS datasets without counting temporary filesystems', () => {
  const data = parseMonitor(snapshot() + 'tank/data 500 100 400 20% /data\n');
  assert.equal(data.disks.length, 3);
  assert.equal(data.disks.at(-1).device, 'tank/data');
});
test('excessive monitor output fails and releases the exec channel', async () => {
  let channel;
  const monitor = new SessionMonitor({
    exec(_cmd, callback) {
      channel = new PassThrough();
      channel.stderr = new PassThrough();
      callback(null, channel);
    },
  });
  const pending = monitor.read();
  channel.write(Buffer.alloc(262145));
  await assert.rejects(pending, /数据过大/);
  assert.equal(channel.destroyed, true);
  monitor.close();
});
test('NAS virtual cloud mounts, overlay and trimafs do not inflate physical disk totals', () => {
  const data = parseMonitor(
    snapshot().split('__DISK__')[0] +
      '__DISK__\n/dev/root ext4 100 40 60 40% /\n/dev/data btrfs 200 150 50 75% /vol1\ntrimafs trimafs 200 150 50 75% /fs\noverlay overlay 200 150 50 75% /docker/merged\ncloud:x fuse.rclone 999999999 0 999999999 0% /cloud\ntank/data zfs 100 20 80 20% /zfs\n',
  );
  assert.equal(data.disks.length, 3);
  assert.equal(data.disk.total, 409600);
  assert.equal(data.disk.percent, 52.5);
});
test('monitor obtains physical interface identity from sysfs while retaining default virtual interfaces', () => {
  const row = (name) => `${name}: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0`;
  const data = parseMonitor(
    snapshot() +
      '\n__NET__\n' +
      row('storage-lan') +
      '\n' +
      row('enp1s0-ovs') +
      '\n__LINK__\nstorage-lan 1 up\nenp1s0-ovs 0 unknown\n__ROUTE__\ndefault via 192.168.1.1 dev enp1s0-ovs\n',
  );
  assert.equal(data.network[0].physical, true);
  assert.equal(data.network[0].state, 'up');
  assert.equal(data.network[1].physical, false);
  assert.deepEqual(data.defaultInterfaces, ['enp1s0-ovs']);
});
