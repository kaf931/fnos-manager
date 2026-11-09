import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import {
  normalizeMac,
  magicPacket,
  validateDevice,
  WakeService,
  sendMagicPacket,
} from '../server/wol.js';
const device = { name: '工作电脑', mac: '02:11:22:33:44:55', address: '192.168.1.255', port: 9 };
test('magic packet normalizes MAC formats and contains exact synchronization and 16 copies', () => {
  for (const mac of ['02-11-22-33-44-55', '0211.2233.4455', '021122334455'])
    assert.equal(normalizeMac(mac), device.mac);
  const packet = magicPacket(device.mac);
  assert.equal(packet.length, 102);
  assert.deepEqual(packet.subarray(0, 6), Buffer.alloc(6, 255));
  for (let i = 0; i < 16; i++)
    assert.equal(packet.subarray(6 + i * 6, 12 + i * 6).toString('hex'), '021122334455');
  for (const mac of [
    'zz:11:22:33:44:55',
    'FF:FF:FF:FF:FF:FF',
    '00:00:00:00:00:00',
    '01:11:22:33:44:55',
  ])
    assert.throws(() => magicPacket(mac));
});
test('device validation rejects public destinations and invalid ports', () => {
  assert.equal(validateDevice(device).port, 9);
  assert.equal(
    validateDevice({ ...device, address: '255.255.255.255' }).address,
    '255.255.255.255',
  );
  for (const address of ['8.8.8.8', '127.0.0.1', '::1', 'localhost', '192.168.1.999'])
    assert.throws(() => validateDevice({ ...device, address }));
  for (const port of [0, 65536, 1.2, '9']) assert.throws(() => validateDevice({ ...device, port }));
});
test('saved devices persist, isolate owners and rate-limit sends; failed send has no success timestamp', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wake-test-'));
  let now = 10000,
    sends = 0;
  try {
    const service = await new WakeService({
        dataDir: dir,
        now: () => now,
        send: async () => {
          sends++;
        },
      }).init(),
      r = await service.save('a', device);
    assert.equal(service.list('b').length, 0);
    await assert.rejects(service.wake('b', r.id), { status: 404 });
    await assert.rejects(service.save('b', device, r.id), { status: 404 });
    await assert.rejects(service.remove('b', r.id), { status: 404 });
    await service.wake('a', r.id);
    assert.equal(sends, 1);
    await assert.rejects(service.wake('a', r.id), { status: 429 });
    const loaded = await new WakeService({ dataDir: dir }).init();
    assert.ok(loaded.list('a')[0].lastSentAt);
    now += 2100;
    service.send = async () => {
      throw Error('network failed');
    };
    await assert.rejects(service.wake('a', r.id), /network failed/);
    assert.equal(service.list('a')[0].lastSentAt, new Date(10000).toISOString());
    await service.remove('a', r.id);
    assert.equal(service.list('a').length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('UDP sender transmits actual magic packet and releases socket', async () => {
  const receiver = dgram.createSocket('udp4');
  try {
    await new Promise((r) => receiver.bind(0, '127.0.0.1', r));
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('missing UDP packet')), 3000);
      receiver.once('message', (packet) => {
        clearTimeout(timer);
        resolve(packet);
      });
    });
    await sendMagicPacket({ ...device, address: '127.0.0.1', port: receiver.address().port });
    assert.deepEqual(await received, magicPacket(device.mac));
  } finally {
    receiver.close();
  }
});

test('batch wake validates every owner before sending, deduplicates, and records partial failures', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wake-batch-'));
  let calls = [],
    now = 10000;
  try {
    const service = await new WakeService({
      dataDir: dir,
      now: () => now,
      send: async (row) => {
        calls.push(row.id);
        if (row.name === 'fail') throw Error('unreachable');
      },
    }).init();
    const a = await service.save('a', device),
      b = await service.save('a', { ...device, name: 'fail' }),
      foreign = await service.save('b', device);
    await assert.rejects(service.wakeMany('a', { ids: [a.id, foreign.id] }), { status: 404 });
    assert.equal(calls.length, 0);
    await assert.rejects(service.wakeMany('a', { ids: [] }), { status: 400 });
    await assert.rejects(service.wakeMany('a', { ids: Array(51).fill(a.id) }), { status: 400 });
    const result = await service.wakeMany('a', { ids: [a.id, b.id, a.id] });
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      result.results.map((r) => r.success),
      [true, false],
    );
    assert.ok(service.get('a', a.id).lastSentAt);
    assert.equal(service.get('a', b.id).lastSentAt, undefined);
    assert.equal(service.active.size, 0);
    await assert.rejects(service.wakeMany('a', { ids: [a.id] }), { status: 429 });
    now += 2100;
    assert.equal((await service.wakeMany('a', { ids: [a.id] })).sent, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
