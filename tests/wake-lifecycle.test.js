import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { WakeService } from '../server/wol.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const device = { name: 'Fixture', mac: '02:11:22:33:44:55', address: '192.168.1.255', port: 9 };

test('closing wake service aborts sends, drains the batch, and rejects subsequent work', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/wake-closing-');
  const sends = [],
    release = [];
  const service = await new WakeService({
    dataDir: dir,
    send: (row, { signal } = {}) =>
      new Promise((resolve, reject) => {
        sends.push({ id: row.id, signal });
        release.push(resolve);
        signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      }),
  }).init();
  let work;
  try {
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push((await service.save('a', { ...device, name: 'Fixture ' + i })).id);
    work = service.wakeMany('a', { ids });
    await tick();
    assert.equal(sends.length, 4);
    await service.close();
    assert.ok(sends.every(({ signal }) => signal?.aborted));
    const result = await work;
    assert.equal(result.failed, 5);
    assert.equal(service.active.size, 0);
    assert.equal(sends.length, 4);
    await assert.rejects(service.wakeMany('a', { ids: [ids[0]] }), /关闭/);
    await assert.rejects(service.save('a', device), /关闭/);
    await assert.rejects(service.remove('a', ids[0]), /关闭/);
  } finally {
    for (let i = 0; i < 10; i++) {
      for (const done of release) done();
      await tick();
    }
    if (work) await work;
    await service.close();
    service.database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('caller cancellation only aborts its wake batch and leaves service available', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/wake-caller-cancel-');
  const service = await new WakeService({
    dataDir: dir,
    send: (_row, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Error('caller aborted')), { once: true });
      }),
  }).init();
  try {
    const saved = await service.save('a', device),
      controller = new AbortController();
    const work = service.wakeMany('a', { ids: [saved.id] }, { signal: controller.signal });
    controller.abort();
    assert.equal((await work).failed, 1);
    assert.equal(service.active.size, 0);
    assert.ok((await service.save('a', { ...device, name: 'still available' })).id);
  } finally {
    await service.close();
    service.database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('power shutdown drains in-flight cancellation before closing and skips queued devices', async () => {
  const { seedPowerConnections } = await import('./fixtures/power-connections.js');
  const dir = await mkdtemp(os.tmpdir() + '/wake-power-close-');
  const connectionId = 'a'.repeat(24);
  seedPowerConnections(dir, { [connectionId]: {} }, 'a');
  const release = [],
    signals = [];
  let cleanupStarted = 0,
    closedPower = false,
    settled = false;
  const power = {
    prepare: () => ({ connection: { host: '192.168.1.20', port: 22, username: 'root' } }),
    execute: (_owner, _row, _action, _prepared, { signal }) =>
      new Promise((_resolve, reject) => {
        signals.push(signal);
        release.push(() => reject(Error('closed')));
        signal.addEventListener(
          'abort',
          () => {
            cleanupStarted++;
          },
          { once: true },
        );
      }),
    close() {
      closedPower = true;
    },
  };
  const service = await new WakeService({
    dataDir: dir,
    power,
    terminalStore: { get: () => ({ kind: 'remote', hasCredentials: true }) },
  }).init();
  let work;
  try {
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push((await service.save('a', { ...device, connectionId, name: 'power ' + i })).id);
    work = service.controlMany('a', { ids, action: 'reboot', confirmed: true });
    assert.equal(signals.length, 4);
    const closing = service.close().then(() => {
      settled = true;
    });
    await tick();
    assert.equal(closedPower, true);
    assert.equal(cleanupStarted, 4);
    assert.equal(settled, false);
    for (const finish of release) finish();
    await closing;
    const result = await work;
    assert.equal(result.failed, 5);
    assert.equal(signals.length, 4);
    assert.equal(service.active.size, 0);
    await assert.rejects(
      service.controlMany('a', { ids: [ids[0]], action: 'reboot', confirmed: true }),
      /关闭/,
    );
  } finally {
    for (let i = 0; i < 10; i++) {
      for (const finish of release) finish();
      await tick();
    }
    if (work) await work;
    await service.close();
    service.database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
