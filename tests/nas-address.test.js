import test from 'node:test';
import assert from 'node:assert/strict';
import { nasAddress } from '../server/nas-address.js';
const interfaces = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
  enp1s0: [{ address: '192.168.1.35', family: 'IPv4', internal: false }],
};
test('native Docker addresses use the NAS LAN interface instead of the gateway loopback hostname', () => {
  assert.equal(nasAddress('localhost', interfaces), '192.168.1.35');
  assert.equal(nasAddress('127.0.0.1', interfaces), '192.168.1.35');
  assert.equal(nasAddress('192.168.1.35', interfaces), '192.168.1.35');
  assert.equal(nasAddress('::1', interfaces), '192.168.1.35');
  assert.equal(nasAddress('localhost', { docker0: interfaces.docker0 }), '');
  assert.equal(nasAddress('localhost', interfaces, 'nas.example.com'), 'nas.example.com');
});
test('multiple NAS interfaces prefer the lowest-metric default route rather than enumeration order', () => {
  const rows = {
    wlo1: [{ address: '192.168.1.32', family: 'IPv4', internal: false }],
    ...interfaces,
  };
  const routes =
    'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\nwlo1 00000000 0101A8C0 0003 0 0 600 00000000 0 0 0\nenp1s0 00000000 0101A8C0 0003 0 0 100 00000000 0 0 0\n';
  assert.equal(nasAddress('localhost', rows, '', routes), '192.168.1.35');
  assert.equal(nasAddress('192.168.1.32', rows, '', routes), '192.168.1.32');
});
