import { legacyNotificationReset } from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { WakeService, validateDevice } from '../server/wol.js';
const device = {
  name: 'PC',
  mac: '02:11:22:33:44:55',
  address: '192.168.1.255',
  ip: '192.168.1.10',
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function fixture(t, options = {}) {
  const dir = await mkdtemp(os.tmpdir() + '/reachability-');
  const s = new WakeService({ dataDir: dir, ...options });
  t.after(async () => {
    await s.close();
    s.database.close();
    await rm(dir, { recursive: true, force: true });
  });
  return s;
}
test('IP validation rejects public, broadcast, network and non IPv4 targets', () => {
  for (const ip of [
    '8.8.8.8',
    '192.168.1.255',
    '10.0.0.0',
    '127.0.0.1',
    '::1',
    'host',
    '192.168.1.1;id',
  ])
    assert.throws(() => validateDevice({ ...device, ip }));
  assert.equal(validateDevice(device).ip, '192.168.1.10');
});
test('checks persist results, expire after 120 seconds and never use broadcast address', async (t) => {
  let now = 100000,
    calls = 0;
  const s = await fixture(t, {
    now: () => now,
    probe: async (ip) => {
      assert.equal(ip, '192.168.1.10');
      calls++;
      return { state: 'online', reason: 'reply' };
    },
  });
  const d = await s.save('a', device);
  assert.equal(d.ip, device.ip);
  assert.equal((await s.checkMany('a', { ids: [d.id] }))[0].presence.state, 'online');
  await s.checkMany('a', { ids: [d.id] });
  assert.equal(calls, 1);
  now += 120001;
  assert.equal(s.list('a')[0].presence.state, 'unknown');
  const no = await s.save('a', { ...device, ip: '' });
  assert.equal((await s.checkMany('a', { ids: [no.id] }))[0].presence.reason, 'no_target');
  assert.equal(calls, 1);
});
test('global cap, ownership preflight, deduplication and edit invalidation', async (t) => {
  const releases = [];
  let active = 0,
    peak = 0,
    calls = 0;
  const s = await fixture(t, {
    probe: (_ip, { signal }) =>
      new Promise((resolve) => {
        calls++;
        peak = Math.max(peak, ++active);
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          active--;
          resolve({ state: 'online', reason: 'reply' });
        };
        releases.push(finish);
        signal.addEventListener('abort', finish, { once: true });
      }),
  });
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await s.save('a', { ...device, name: String(i) })).id);
  await assert.rejects(s.checkMany('a', { ids: [ids[0], 'missing'] }));
  assert.equal(calls, 0);
  const a = s.checkMany('a', { ids: ids.slice(0, 3) }),
    b = s.checkMany('a', { ids: ids.slice(2) });
  await tick();
  assert.equal(calls, 4);
  assert.equal(s.list('a')[0].checking, true);
  await s.save('a', { ...device, ip: '192.168.1.20' }, ids[0]);
  for (let i = 0; i < 5; i++) {
    releases.forEach((f) => f());
    await tick();
  }
  await Promise.all([a, b]);
  assert.equal(peak, 4);
  assert.equal(calls, 6);
  assert.equal(s.list('a')[0].presence, undefined);
});
test('shutdown aborts probes and does not write cancelled results', async (t) => {
  const s = await fixture(t, {
    probe: (_ip, { signal }) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => resolve({ state: 'online', reason: 'reply' }), {
          once: true,
        }),
      ),
  });
  const d = await s.save('a', device);
  const work = s.checkMany('a', { ids: [d.id] });
  await tick();
  await s.close();
  await work;
  assert.equal(s.repository.find('a', d.id).presence, undefined);
  await assert.rejects(s.checkMany('a', { ids: [d.id] }), /关闭/);
});

test('successful wake followups stop on first reply and are cancelled by edits', async (t) => {
  const s = await fixture(t, {
    send: async () => {},
    probe: async () => ({ state: 'online', reason: 'reply' }),
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = await s.save('a', device);
  await s.wake('a', d.id);
  assert.equal(s.list('a')[0].checking, true);
  t.mock.timers.tick(5000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(s.list('a')[0].presence?.state, 'online');
  assert.equal(s.list('a')[0].checking, false);
  const d2 = await s.save('b', device);
  await s.wake('b', d2.id);
  await s.save('b', { ...device, ip: '192.168.1.11' }, d2.id);
  t.mock.timers.tick(30000);
  await Promise.resolve();
  assert.equal(s.list('b')[0].presence, undefined);
  assert.equal(s.list('b')[0].checking, false);
});
test('SSH fallback only uses private remote IPv4 and changed host invalidates late replies', async (t) => {
  const { TerminalRepository } = await import('../server/persistence/terminal.repository.js');
  const connection = {
    id: 'a'.repeat(24),
    ownerUid: 'a',
    name: 'SSH',
    kind: 'remote',
    host: '192.168.1.12',
    port: 22,
    username: 'root',
    hasCredentials: true,
  };
  let finish;
  const s = await fixture(t, {
    terminalStore: { get: () => connection },
    probe: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  new TerminalRepository(s.database).save(connection);
  const d = await s.save('a', { ...device, ip: '', connectionId: connection.id });
  const work = s.checkMany('a', { ids: [d.id] });
  await tick();
  connection.host = '192.168.1.13';
  finish({ state: 'online', reason: 'reply' });
  await work;
  assert.equal(s.list('a')[0].presence, undefined);
  await s.save('a', { ...device, ip: '', connectionId: connection.id }, d.id);
  connection.host = 'example.com';
  assert.equal((await s.checkMany('a', { ids: [d.id] }))[0].presence.reason, 'no_target');
});
test('v16 migration preserves devices and is idempotent; probe rows cascade on deletion', async (t) => {
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const s = await fixture(t, { probe: async () => ({ state: 'offline', reason: 'no_reply' }) });
  const d = await s.save('a', device);
  await s.checkMany('a', { ids: [d.id] });
  assert.equal(s.database.connection.prepare('SELECT count(*) n FROM wake_presence').get().n, 1);
  await s.remove('a', d.id);
  assert.equal(s.database.connection.prepare('SELECT count(*) n FROM wake_presence').get().n, 0);
  const kept = await s.save('a', device);
  s.database.connection.exec(
    legacyNotificationReset +
      'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=16',
  );
  s.database.close();
  const db = new DatabaseService(s.dataDir);
  assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(
    db.connection.prepare('SELECT name FROM wake_devices WHERE id=?').get(kept.id).name,
    'PC',
  );
  assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  const reopened = new DatabaseService(s.dataDir);
  assert.equal(
    reopened.connection.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=17').get()
      .n,
    1,
  );
  assert.equal(
    reopened.connection.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=20').get()
      .n,
    1,
  );
  reopened.close();
});
test('shutdown drains invalidated background probes before allowing database close', async (t) => {
  let finish;
  const s = await fixture(t, {
    send: async () => {},
    probe: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = await s.save('a', device);
  await s.wake('a', d.id);
  t.mock.timers.tick(5000);
  await Promise.resolve();
  await Promise.resolve();
  await s.save('a', { ...device, ip: '192.168.1.11' }, d.id);
  let closed = false;
  const closing = s.close().then(() => {
    closed = true;
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(closed, false);
  finish({ state: 'online', reason: 'reply' });
  await closing;
  assert.equal(s.list('a')[0].presence, undefined);
});

test('Linux ping classifies replies, no replies, errors and enforces process timeout', async (t) => {
  const { ping } = await import('../server/wake-reachability.js');
  const { writeFile, chmod } = await import('node:fs/promises');
  const dir = await mkdtemp(os.tmpdir() + '/ping-fixture-');
  const oldPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  });
  process.env.PATH = dir;
  for (const [code, state, reason] of [
    [0, 'online', 'reply'],
    [1, 'offline', 'no_reply'],
    [2, 'unknown', 'unavailable'],
  ]) {
    await writeFile(
      dir + '/ping',
      `#!/bin/sh\n[ "$*" = "-n -c 1 -W 2 192.168.1.10" ] || exit 2\nexit ${code}\n`,
    );
    await chmod(dir + '/ping', 0o700);
    assert.deepEqual(await ping('192.168.1.10', { signal: new AbortController().signal }), {
      state,
      reason,
    });
  }
  await writeFile(dir + '/ping', '#!/bin/sh\nexec /bin/sleep 10\n');
  const start = Date.now();
  assert.deepEqual(await ping('192.168.1.10', { signal: new AbortController().signal }), {
    state: 'unknown',
    reason: 'unavailable',
  });
  assert.ok(Date.now() - start < 5000);
  await rm(dir + '/ping');
  assert.equal(
    (await ping('192.168.1.10', { signal: new AbortController().signal })).reason,
    'unavailable',
  );
});
