import { legacyNotificationReset } from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../server/persistence/database.service.js';
import { AdbRepository } from '../server/persistence/adb.repository.js';
import { TerminalRepository } from '../server/persistence/terminal.repository.js';
import { WakeRepository } from '../server/persistence/wake.repository.js';
import { TaskRepository } from '../server/persistence/task.repository.js';
import { TaskEngine } from '../server/tasks/engine.js';
import { BackupService } from '../server/backup/service.js';
function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'backup-'));
  const database = new DatabaseService(dir);
  t.after(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, database, service: new BackupService(database, 'test') };
}
const connection = (ownerUid, id = 'a'.repeat(24)) => ({
  id,
  ownerUid,
  name: 'server',
  kind: 'remote',
  host: '192.168.1.2',
  port: 22,
  username: 'root',
  authMethod: 'password',
  credentials: { method: 'password', password: 'secret' },
});
const backup = (items) => ({
  format: 'fnos-manager-config',
  version: 1,
  exportedAt: new Date().toISOString(),
  appVersion: 'test',
  includeCredentials: false,
  items,
});
const sshItem = (id = 'a'.repeat(24)) => ({
  kind: 'connections',
  id,
  data: {
    name: 'server',
    kind: 'remote',
    host: '192.168.1.2',
    port: 22,
    username: 'root',
    folderId: null,
  },
});
test('export isolates accounts, strips credentials and includes device/task dependencies', async (t) => {
  const { database, service } = setup(t);
  const ssh = new TerminalRepository(database),
    wake = new WakeRepository(database),
    tasks = new TaskRepository(database);
  ssh.save(connection('1'));
  ssh.save(connection('2', 'b'.repeat(24)));
  wake.save({
    id: 'c'.repeat(24),
    owner: '1',
    name: 'computer',
    mac: '02:11:22:33:44:55',
    address: '255.255.255.255',
    port: 9,
    system: 'linux',
    connectionId: 'a'.repeat(24),
  });
  tasks.save({
    id: 'd'.repeat(16),
    ownerUid: '1',
    name: 'wake',
    type: 'device-wake',
    enabled: true,
    schedule: { kind: 'daily', time: '10:00' },
    timeoutSeconds: 300,
    nextRunAt: null,
    deviceIds: ['c'.repeat(24)],
  });
  const pkg = await service.export('1', { modules: ['tasks'], includeCredentials: false });
  assert.equal(pkg.items.filter((i) => i.kind === 'connections').length, 1);
  assert.equal(JSON.stringify(pkg).includes('secret'), false);
  const exported = pkg.items.find((i) => i.kind === 'connections');
  assert.equal(exported.data.authMethod, undefined);
  assert.equal(exported.data.ownerUid, undefined);
  const secret = await service.export('1', { modules: ['ssh'], includeCredentials: true });
  assert.equal(
    secret.items.find((i) => i.kind === 'connections').data.credentials.password,
    'secret',
  );
});
test('restore remaps ids and owners; persists idempotent receipt across service restart', async (t) => {
  const { database, service } = setup(t);
  const pkg = backup([sshItem()]);
  const preview = await service.preview('2', pkg),
    requestId = randomUUID();
  const input = { token: preview.token, requestId, decisions: [] };
  const result = await service.restore('2', input);
  assert.equal(result.imported, 1);
  const receipt = database.connection
    .prepare('SELECT * FROM backup_receipts WHERE request_id=?')
    .get(requestId);
  assert.equal(receipt.package_digest, preview.packageDigest);
  assert.match(receipt.selection_digest, /^[a-f0-9]{64}$/);
  const rows = new TerminalRepository(database).list('2');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].id, pkg.items[0].id);
  assert.equal(rows[0].authMethod, undefined);
  assert.deepEqual(await new BackupService(database, 'test').restore('2', input), result);
  await assert.rejects(
    () =>
      service.restore('2', { ...input, decisions: [{ key: preview.rows[0].key, action: 'skip' }] }),
    /请求|重复/,
  );
});
test('rejects stale previews and wrong account without creating rows', async (t) => {
  const { database, service } = setup(t);
  const preview = await service.preview('1', backup([sshItem()]));
  const input = { token: preview.token, requestId: randomUUID(), decisions: [] };
  await assert.rejects(() => service.restore('2', input), /预览/);
  new TerminalRepository(database).save(connection('1', 'b'.repeat(24)));
  await assert.rejects(() => service.restore('1', input), /变化|预览/);
  assert.equal(new TerminalRepository(database).list().length, 1);
});
test('validates versions, illegal fields, duplicate ids and missing dependencies', async (t) => {
  const { service } = setup(t);
  for (const pkg of [
    { ...backup([]), version: 2 },
    backup([{ ...sshItem(), data: { ...sshItem().data, ownerUid: '2' } }]),
    backup([sshItem(), sshItem()]),
    backup([{ ...sshItem(), data: { ...sshItem().data, folderId: 'b'.repeat(24) } }]),
  ])
    await assert.rejects(() => service.preview('1', pkg));
});
test('conflict defaults to skip and requires explicit compatible dependency mapping', async (t) => {
  const { database, service } = setup(t);
  new TerminalRepository(database).save(connection('1', 'b'.repeat(24)));
  const pkg = backup([
    sshItem(),
    {
      kind: 'devices',
      id: 'c'.repeat(24),
      data: {
        name: 'pc',
        mac: '02:11:22:33:44:55',
        address: '255.255.255.255',
        port: 9,
        system: 'linux',
        connectionId: 'a'.repeat(24),
      },
    },
  ]);
  const p = await service.preview('1', pkg);
  assert.equal(p.rows[0].defaultAction, 'skip');
  await assert.rejects(
    () => service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] }),
    /依赖/,
  );
  assert.equal(new WakeRepository(database).list().length, 0);
  const r = await service.restore('1', {
    token: p.token,
    requestId: randomUUID(),
    decisions: [{ key: p.rows[0].key, action: 'map', targetId: 'b'.repeat(24) }],
  });
  assert.equal(r.imported, 1);
  assert.equal(r.mapped, 1);
  assert.equal(new WakeRepository(database).list('1')[0].connectionId, 'b'.repeat(24));
});
test('imported tasks paused and pending tasks cannot execute manually or on schedule', async (t) => {
  const { database, service, dir } = setup(t);
  const pkg = backup([
    {
      kind: 'tasks',
      id: 'd'.repeat(16),
      data: {
        name: 'restart',
        type: 'reboot',
        schedule: { kind: 'daily', time: '10:00' },
        timeoutSeconds: 300,
      },
    },
  ]);
  const p = await service.preview('1', pkg);
  await service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] });
  const repo = new TaskRepository(database),
    row = repo.list()[0];
  assert.equal(row.enabled, false);
  assert.equal(row.nextRunAt, null);
  assert.ok(row.pendingReason);
  let executed = 0;
  const engine = new TaskEngine(dir, {
    database,
    runner: async () => {
      executed++;
      return { code: 0 };
    },
  });
  t.after(() => engine.close());
  await assert.rejects(() => engine.run(row.id), /待完善|重新/);
  repo.save({ ...row, enabled: true, nextRunAt: new Date(0).toISOString() });
  await engine.tick();
  assert.equal(executed, 0);
});
test('restore validates images, normalizes menu links and clears desktop install state', async (t) => {
  const { database, service } = setup(t);
  const sharp = (await import('sharp')).default;
  const image = (
    await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } })
      .png()
      .toBuffer()
  ).toString('base64');
  const pkg = backup([
    {
      kind: 'icons',
      id: 'e'.repeat(16),
      data: {
        name: 'tools',
        menuPage: 'tasks',
        url: 'javascript:alert(1)',
        mode: 'url',
        containerId: 'old',
        image,
      },
    },
  ]);
  const p = await service.preview('1', pkg);
  await service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] });
  const row = database.connection.prepare('SELECT * FROM icons').get();
  assert.equal(row.url, '/app/deskicons/?page=tasks&standalone=1');
  assert.equal(row.applied_revision, 0);
  assert.equal(row.container_id, null);
  await assert.rejects(
    () =>
      service.preview(
        '1',
        backup([
          {
            ...pkg.items[0],
            data: { ...pkg.items[0].data, image: Buffer.from('<svg/>').toString('base64') },
          },
        ]),
      ),
    /图片/,
  );
});
test('only compatible mapping candidates are offered and foreign owner cannot be mapped', async (t) => {
  const { database, service } = setup(t);
  const ssh = new TerminalRepository(database);
  ssh.save({ ...connection('1', 'b'.repeat(24)), kind: 'local', host: '127.0.0.1' });
  ssh.save(connection('2', 'c'.repeat(24)));
  const p = await service.preview('1', backup([sshItem()]));
  assert.equal(p.rows[0].candidates.length, 0);
  for (const targetId of ['b'.repeat(24), 'c'.repeat(24)])
    await assert.rejects(
      () =>
        service.restore('1', {
          token: p.token,
          requestId: randomUUID(),
          decisions: [{ key: p.rows[0].key, action: 'map', targetId }],
        }),
      /映射/,
    );
});
test('rejects cycles, wrong enum and non-number task timeout', async (t) => {
  const { service } = setup(t);
  await assert.rejects(
    () =>
      service.preview(
        '1',
        backup([
          { kind: 'folders', id: 'a', data: { name: 'loop', scope: 'assets', parentId: 'a' } },
        ]),
      ),
    /循环/,
  );
  await assert.rejects(() =>
    service.preview('1', backup([{ ...sshItem(), data: { ...sshItem().data, kind: 'other' } }])),
  );
  await assert.rejects(() =>
    service.preview(
      '1',
      backup([
        {
          kind: 'tasks',
          id: 'd'.repeat(16),
          data: {
            name: 'test',
            type: 'script',
            script: 'true',
            schedule: { kind: 'daily', time: '10:00' },
            timeoutSeconds: '300',
          },
        },
      ]),
    ),
  );
});
test('rollback includes earlier writes when mapped folder would exceed depth limit', async (t) => {
  const { database, service } = setup(t);
  const { WorkspaceRepository } = await import('../server/persistence/workspace.repository.js');
  const repo = new WorkspaceRepository(database);
  let parentId = null;
  for (let i = 0; i < 16; i++) {
    const id = String(i).padStart(24, '0');
    repo.save({ id, ownerUid: '1', name: 'level' + i, scope: 'assets', kind: 'folder', parentId });
    parentId = id;
  }
  const pkg = backup([
    sshItem(),
    { kind: 'folders', id: 'root', data: { name: 'root', scope: 'assets', parentId: null } },
    { kind: 'folders', id: 'child', data: { name: 'child', scope: 'assets', parentId: 'root' } },
  ]);
  const p = await service.preview('1', pkg);
  await assert.rejects(
    () =>
      service.restore('1', {
        token: p.token,
        requestId: randomUUID(),
        decisions: [{ key: 'folders:root', action: 'map', targetId: parentId }],
      }),
    /16/,
  );
  assert.equal(new TerminalRepository(database).list('1').length, 0);
  assert.equal(repo.list('1').length, 16);
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM backup_receipts').get().n, 0);
});
test('combined limits and renamed collisions reject the entire batch', async (t) => {
  const { database, service } = setup(t),
    ssh = new TerminalRepository(database);
  for (let i = 0; i < 100; i++)
    ssh.save({ ...connection('1', String(i).padStart(24, '0')), name: 'server' + i });
  const p = await service.preview('1', backup([sshItem()]));
  await assert.rejects(
    () => service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] }),
    /上限/,
  );
  assert.equal(ssh.list('1').length, 100);
});
test('restored power task has remapped devices but no confirmation snapshot', async (t) => {
  const { database, service } = setup(t);
  const pkg = backup([
    sshItem(),
    {
      kind: 'devices',
      id: 'c'.repeat(24),
      data: {
        name: 'pc',
        mac: '02:11:22:33:44:55',
        address: '255.255.255.255',
        port: 9,
        system: 'linux',
        connectionId: 'a'.repeat(24),
      },
    },
    {
      kind: 'tasks',
      id: 'd'.repeat(16),
      data: {
        name: 'shutdown',
        type: 'device-shutdown',
        schedule: { kind: 'daily', time: '10:00' },
        timeoutSeconds: 300,
        deviceIds: ['c'.repeat(24)],
      },
    },
  ]);
  const p = await service.preview('1', pkg);
  await service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] });
  const task = new TaskRepository(database).list()[0],
    device = new WakeRepository(database).list('1')[0];
  assert.deepEqual(task.deviceIds, [device.id]);
  assert.equal(task.deviceTargets, undefined);
  assert.equal(task.acknowledged, false);
  assert.ok(task.pendingReason);
  assert.equal(task.ownerUid, '1');
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM ssh_known_hosts').get().n, 0);
});
test('catalog restore creates preference row without overwriting existing choices', async (t) => {
  const { database, service } = setup(t);
  const { CommandRepository } = await import('../server/persistence/command.repository.js');
  const pkg = backup([
    {
      kind: 'commands',
      id: 'command',
      data: { command: 'ls -la', description: 'list', category: 'files' },
    },
  ]);
  const p = await service.preview('1', pkg);
  await service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] });
  assert.equal(new CommandRepository(database).list('1').length, 1);
  assert.equal(
    database.connection
      .prepare('SELECT catalog_initialized FROM user_preferences WHERE owner_uid=?')
      .get('1').catalog_initialized,
    1,
  );
});
test('preview expires after fifteen minutes', async (t) => {
  const { service } = setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const p = await service.preview('1', backup([sshItem()]));
  t.mock.timers.tick(16 * 60 * 1000);
  await assert.rejects(
    () => service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] }),
    /过期/,
  );
});
test('version 13 migration preserves configuration and adds pending state/receipts', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'backup-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = new DatabaseService(dir);
  new TerminalRepository(db).save(connection('1'));
  db.connection.exec(
    legacyNotificationReset +
      'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE IF EXISTS adb_connections; DELETE FROM schema_migrations WHERE version=29; DROP TABLE history_limits; DELETE FROM schema_migrations WHERE version>=21; DROP TABLE vnc_preferences; DELETE FROM schema_migrations WHERE version=20; DROP TABLE rdp_connections; DROP TABLE vnc_connections; DELETE FROM schema_migrations WHERE version=19; DROP TABLE text_file_versions; DELETE FROM schema_migrations WHERE version=18; DROP TABLE wake_presence; ALTER TABLE wake_devices DROP COLUMN ip; DELETE FROM schema_migrations WHERE version=17; DROP TABLE operation_records; DROP TABLE operation_settings; DELETE FROM schema_migrations WHERE version=16; DROP TABLE notification_deliveries; DROP TABLE notification_settings; DELETE FROM schema_migrations WHERE version=15; DROP TABLE backup_receipts; ALTER TABLE tasks DROP COLUMN pending_reason; DELETE FROM schema_migrations WHERE version=14; ALTER TABLE user_preferences DROP COLUMN palette; ALTER TABLE user_preferences DROP COLUMN terminal_background; DELETE FROM schema_migrations WHERE version=24; DELETE FROM schema_migrations WHERE version=25; DELETE FROM schema_migrations WHERE version=26; DELETE FROM schema_migrations WHERE version=27; DELETE FROM schema_migrations WHERE version=28; DROP TABLE IF EXISTS update_settings; PRAGMA user_version=13',
  );
  db.close();
  db = new DatabaseService(dir);
  try {
    assert.equal(new TerminalRepository(db).list('1').length, 1);
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 36);
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.connection.prepare('SELECT COUNT(*) n FROM backup_receipts').get().n, 0);
  } finally {
    db.close();
  }
});
test('engine rejects enabling pending tasks without explicit review and permits validated edit', async (t) => {
  const { service, database, dir } = setup(t);
  const p = await service.preview(
    '1',
    backup([
      {
        kind: 'tasks',
        id: 'd'.repeat(16),
        data: {
          name: 'script',
          type: 'script',
          script: 'true',
          schedule: { kind: 'daily', time: '10:00' },
          timeoutSeconds: 300,
        },
      },
    ]),
  );
  await service.restore('1', { token: p.token, requestId: randomUUID(), decisions: [] });
  const row = new TaskRepository(database).list()[0],
    engine = new TaskEngine(dir, { database, runner: async () => ({ code: 0 }) });
  t.after(() => engine.close());
  await assert.rejects(() => engine.update(row.id, { ...row, enabled: true }), /待完善|确认/);
  await assert.rejects(() => engine.update(row.id, { ...row, enabled: false }), /待完善|确认/);
  const updated = await engine.update(row.id, {
    ...row,
    enabled: false,
    reviewedAfterRestore: true,
  });
  assert.equal(updated.pendingReason, undefined);
  assert.equal(updated.enabled, false);
});
test('completed restore remains idempotent after preview expiry and service restart', async (t) => {
  const { database, service } = setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const p = await service.preview('1', backup([sshItem()]));
  const input = { token: p.token, requestId: randomUUID(), decisions: [] };
  const result = await service.restore('1', input);
  t.mock.timers.tick(16 * 60 * 1000);
  assert.deepEqual(await new BackupService(database, 'test').restore('1', input), result);
  assert.equal(new TerminalRepository(database).list('1').length, 1);
});
test('rejects device references to local SSH in packages and mapped existing devices', async (t) => {
  const { database, service } = setup(t);
  const local = { ...sshItem(), data: { ...sshItem().data, kind: 'local', host: '127.0.0.1' } };
  const device = {
    kind: 'devices',
    id: 'c'.repeat(24),
    data: {
      name: 'pc',
      mac: '02:11:22:33:44:55',
      address: '255.255.255.255',
      port: 9,
      system: 'linux',
      connectionId: local.id,
    },
  };
  await assert.rejects(() => service.preview('1', backup([local, device])), /远程|remote/);
  new TerminalRepository(database).save({
    ...connection('1', 'b'.repeat(24)),
    kind: 'local',
    host: '127.0.0.1',
  });
  new WakeRepository(database).save({
    ...device.data,
    id: 'e'.repeat(24),
    owner: '1',
    connectionId: 'b'.repeat(24),
  });
  const task = {
    kind: 'tasks',
    id: 'd'.repeat(16),
    data: {
      name: 'wake',
      type: 'device-wake',
      schedule: { kind: 'daily', time: '10:00' },
      timeoutSeconds: 300,
      deviceIds: [device.id],
    },
  };
  const p = await service.preview('1', backup([sshItem(), device, task]));
  await assert.rejects(
    () =>
      service.restore('1', {
        token: p.token,
        requestId: randomUUID(),
        decisions: [{ key: 'devices:' + device.id, action: 'map', targetId: 'e'.repeat(24) }],
      }),
    /远程|remote/,
  );
  assert.equal(new TaskRepository(database).list().length, 0);
});
test('preview storage has a global 64 MiB budget across accounts and releases expired entries', async (t) => {
  const { service } = setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const items = Array.from({ length: 1000 }, (_, i) => ({
    kind: 'shortcuts',
    id: 'command' + i,
    data: { name: 'command' + i, parentId: null, content: 'x'.repeat(16384) },
  }));
  const pkg = backup(items);
  let accepted = 0,
    rejected = false;
  for (let i = 0; i < 6; i++) {
    try {
      await service.preview(String(i + 1), pkg);
      accepted++;
    } catch (error) {
      assert.match(error.message, /预览.*(容量|空间|上限)/);
      rejected = true;
      break;
    }
  }
  assert.ok(accepted >= 1 && accepted <= 4);
  assert.equal(rejected, true);
  t.mock.timers.tick(16 * 60 * 1000);
  assert.ok((await service.preview('20', pkg)).token);
});
test('import credentials use the same private key validation as normal SSH saves', async (t) => {
  const { service } = setup(t);
  const invalid = {
    ...sshItem(),
    data: {
      ...sshItem().data,
      authMethod: 'privateKey',
      credentials: { method: 'privateKey', privateKey: 'not a private key', passphrase: '' },
    },
  };
  await assert.rejects(
    () => service.preview('1', { ...backup([invalid]), includeCredentials: true }),
    /凭据|私钥/,
  );
});

test('device backup roundtrips private IP and excludes observed presence', async (t) => {
  const { database, service } = setup(t);
  const repository = new WakeRepository(database);
  repository.save({
    id: 'f'.repeat(24),
    owner: '1',
    name: 'PC',
    mac: '02:11:22:33:44:55',
    address: '192.168.1.255',
    ip: '192.168.1.20',
    port: 9,
    system: 'linux',
    connectionId: null,
  });
  database.connection
    .prepare('INSERT INTO wake_presence VALUES(?,?,?,?,?)')
    .run('f'.repeat(24), '192.168.1.20', 'online', 'reply', 1000);
  const pkg = await service.export('1', { modules: ['wake'], includeCredentials: false });
  const item = pkg.items.find((i) => i.kind === 'devices');
  assert.equal(item.data.ip, '192.168.1.20');
  assert.equal(item.data.presence, undefined);
  assert.equal(item.data.checking, undefined);
  const preview = await service.preview('2', pkg);
  await service.restore('2', { token: preview.token, requestId: randomUUID(), decisions: [] });
  assert.equal(repository.list('2')[0].ip, '192.168.1.20');
  assert.equal(database.connection.prepare('SELECT count(*) n FROM wake_presence').get().n, 1);
});

test('ADB configuration backup restores per-owner connections without pairing credentials', async (t) => {
  const { database, service } = setup(t),
    repo = new AdbRepository(database);
  repo.save('1', {
    name: 'Phone',
    protocol: 'adb',
    host: '192.168.1.61',
    port: 5555,
    deviceType: 'network',
    serial: '',
    folderId: null,
  });
  const pkg = await service.export('1', { modules: ['ssh'], includeCredentials: false });
  assert.equal(pkg.items.filter((item) => item.kind === 'adb').length, 1);
  assert.equal(JSON.stringify(pkg).includes('adbkey'), false);
  const preview = await service.preview('2', pkg);
  const result = await service.restore('2', {
    token: preview.token,
    requestId: randomUUID(),
    decisions: [],
  });
  assert.equal(result.imported, 1);
  assert.equal(repo.list('2')[0].protocol, 'adb');
  assert.equal(repo.list('2')[0].host, '192.168.1.61');
  assert.equal(repo.list('1').length, 1);
});
