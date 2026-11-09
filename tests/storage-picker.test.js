import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialDirectoryPicker } from '../.web-test/storage-picker.js';
import { isPhysicalVolume } from '../server/storage/service.js';
test('only physical volume roots are listed, never vol00/vol01/vol02 routing trees', () => {
  assert.equal(isPhysicalVolume('vol1'), true);
  assert.equal(isPhysicalVolume('vol12'), true);
  for (const n of ['vol00', 'vol01', 'vol02', 'volume1']) assert.equal(isPhysicalVolume(n), false);
});
test('official picker requests a single directory and normalizes cancellation', async () => {
  let params;
  const pick = createOfficialDirectoryPicker({
    isHost: () => true,
    createApp: () => ({
      ready: async () => {},
      isWeb: true,
      isStandaloneWeb: false,
      pickFile: async (p) => {
        params = p;
        return ['/vol1/1000/music'];
      },
    }),
  });
  assert.deepEqual(await pick(), { supported: true, path: '/vol1/1000/music' });
  assert.equal(params.directory, true);
  assert.equal(params.multiple, false);
  const cancel = createOfficialDirectoryPicker({
    isHost: () => true,
    createApp: () => ({ ready: async () => {}, isWeb: false, pickFile: async () => undefined }),
  });
  assert.deepEqual(await cancel(), { supported: true, path: null });
});
test('standalone preview uses local picker without starting a host handshake', async () => {
  let created = false;
  const pick = createOfficialDirectoryPicker({
    isHost: () => false,
    createApp: () => {
      created = true;
    },
  });
  assert.deepEqual(await pick(), { supported: false, path: null });
  assert.equal(created, false);
});

test('host SDK creation failure falls back to the application directory picker and can retry', async () => {
  let attempts = 0;
  const pick = createOfficialDirectoryPicker({
    isHost: () => true,
    createApp: async () => {
      if (++attempts === 1) throw Error('bridge unavailable');
      return { ready: async () => {}, isWeb: false, pickFile: async () => ['/vol1'] };
    },
  });
  assert.deepEqual(await pick(), { supported: false, path: null });
  assert.deepEqual(await pick(), { supported: true, path: '/vol1' });
});

test('directory picker timeout covers SDK creation and ignores late initialization', async () => {
  let resolve,
    calls = 0,
    latePicks = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const pick = createOfficialDirectoryPicker({
    isHost: () => true,
    timeoutMs: 10,
    createApp: async () =>
      ++calls === 1
        ? pending
        : {
            ready: async () => {},
            isWeb: false,
            pickFile: async () => ['/vol2'],
          },
  });
  const outcome = await Promise.race([
    pick(),
    new Promise((done) => setTimeout(() => done('hung'), 80)),
  ]);
  assert.deepEqual(outcome, { supported: false, path: null });
  assert.deepEqual(await pick(), { supported: true, path: '/vol2' });
  resolve({
    ready: async () => {},
    isWeb: false,
    pickFile: async () => {
      latePicks++;
      return ['/vol1'];
    },
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(latePicks, 0);
  assert.deepEqual(await pick(), { supported: true, path: '/vol2' });
});
