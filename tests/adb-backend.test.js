import {legacyNotificationReset} from './fixtures/notification-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const dir = await mkdtemp(path.join(os.tmpdir(), 'adb-test-'));
try {
  await build({
    entryPoints: [
      'backend/adb/model.ts',
      'backend/persistence/adb.repository.ts',
      'backend/adb/runtime.ts',
    ],
    outdir: dir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
} catch (error) {
  await rm(dir, { recursive: true, force: true });
  throw error;
}
const { validateAdbConnection, remotePath, quoteRemoteArg } = await import(
  path.join(dir, 'adb/model.js')
);
const { AdbRepository } = await import(path.join(dir, 'persistence/adb.repository.js'));
const { DatabaseService } = await import('../server/persistence/database.service.js');
test('ADB rejects option injection, malformed ports and unsafe device serials', () => {
  const valid = { protocol: 'adb', name: 'phone', host: '192.168.1.5', port: 5555 };
  assert.equal(validateAdbConnection(valid).host, valid.host);
  for (const input of [
    { ...valid, host: '--help' },
    { ...valid, port: '5555' },
    { ...valid, deviceType: 'usb', serial: '-s exploit' },
  ])
    assert.throws(() => validateAdbConnection(input));
  assert.throws(() => remotePath('/sdcard/../data'));
  assert.equal(quoteRemoteArg("/sdcard/a'b"), "'/sdcard/a'\\''b'");
});
test('ADB persistence scopes reads/mutations and asset folders by owner', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'adb-db-'));
  const db = new DatabaseService(data);
  try {
    const repo = new AdbRepository(db);
    const row = repo.save('1', { protocol: 'adb', name: 'phone', host: 'phone.local', port: 5555 });
    assert.equal(repo.list('1').length, 1);
    assert.deepEqual(repo.list('2'), []);
    assert.throws(() => repo.get('2', row.id));
    assert.throws(() => repo.save('2', { ...row, name: 'stolen' }, row.id));
    assert.throws(() => repo.move('1', row.id, 'unknown-folder'));
    repo.remove('2', row.id);
    assert.equal(repo.list('1').length, 1);
  } finally {
    db.close();
    await rm(data, { recursive: true, force: true });
  }
});
process.on('exit', () => {});
const { AdbRuntime } = await import(path.join(dir, 'adb/runtime.js'));
test('managed runtime binds loopback, isolates owners, honors timeout, and protects runtime home', async () => {
  const { stat } = await import('node:fs/promises');
  const data = await mkdtemp(path.join(os.tmpdir(), 'adb-runtime-'));
  const previous = process.env.DESKICONS_ADB_PATH;
  process.env.DESKICONS_ADB_PATH = path.resolve('tests/fixtures/adb-cli.js');
  const runtime = new AdbRuntime(process.cwd(), data);
  try {
    const a = await runtime.owner('owner-a'),
      again = await runtime.owner('owner-a'),
      b = await runtime.owner('owner-b');
    assert.equal(a, again);
    assert.deepEqual(a.child.spawnargs.slice(1), ['-L', `tcp:${a.port}`, 'nodaemon', 'server']);
    assert.equal(a.child.spawnargs.includes('-a'), false);
    assert.notEqual(a.port, b.port);
    assert.notEqual(a.home, b.home);
    assert.equal((await stat(a.home)).mode & 0o777, 0o700);
    assert.match(await runtime.run('owner-a', ['devices', '-l']), /USB123/);
    await assert.rejects(
      () => runtime.run('owner-a', ['-s', 'USB123', 'shell', 'timeout'], { timeout: 30 }),
      /超时/,
    );
    await runtime.close();
    assert.equal(a.child.killed, true);
    await assert.rejects(() => runtime.owner('owner-a'), /停止/);
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.DESKICONS_ADB_PATH;
    else process.env.DESKICONS_ADB_PATH = previous;
    await rm(data, { recursive: true, force: true });
  }
});
test('schema28 upgrade preserves existing connections and creates constrained ADB storage once', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'adb-migration-'));
  let db = new DatabaseService(data);
  try {
    db.connection.exec(
      "INSERT INTO vnc_connections(id,owner_uid,name,host,port,username,password,created_at,updated_at) VALUES('existing','owner','saved','localhost',5900,'user','',1,1)",
    );
    db.connection.exec(
      legacyNotificationReset + 'DROP TABLE IF EXISTS notification_options; DELETE FROM schema_migrations WHERE version=30; DROP TABLE adb_connections;DELETE FROM schema_migrations WHERE version=29;PRAGMA user_version=28',
    );
    db.close();
    db = new DatabaseService(data);
    assert.equal(db.connection.prepare('PRAGMA user_version').get().user_version, 33);
    assert.equal(
      db.connection.prepare("SELECT name FROM vnc_connections WHERE id='existing'").get().name,
      'saved',
    );
    assert.equal(new AdbRepository(db).list('owner').length, 0);
    assert.equal(db.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
    db = new DatabaseService(data);
    assert.equal(
      db.connection.prepare('SELECT count(*) n FROM schema_migrations WHERE version=29').get().n,
      1,
    );
  } finally {
    db.close();
    await rm(data, { recursive: true, force: true });
  }
});
test('closing a session cancels active commands and removes partial upload temporary files', async () => {
  const { AdbSessions } = await import('../server/adb/service.js');
  const { PassThrough } = await import('node:stream');
  const { readdir } = await import('node:fs/promises');
  const data = await mkdtemp(path.join(os.tmpdir(), 'adb-cancel-'));
  const previous = process.env.DESKICONS_ADB_PATH;
  process.env.DESKICONS_ADB_PATH = path.resolve('tests/fixtures/adb-cli.js');
  const sessions = new AdbSessions(process.cwd(), data);
  try {
    const connection = {
      ...validateAdbConnection({ protocol: 'adb', name: 'phone', host: 'phone.local', port: 5555 }),
      id: 'adb-test',
      ownerUid: 'owner',
    };
    const created = await sessions.create('owner', connection, 'http://nas:5666');
    const command = sessions.shell('owner', created.id, 'timeout');
    const checked = assert.rejects(command, /取消/);
    const stream = new PassThrough();
    const upload = sessions.upload('owner', created.id, stream, '/sdcard/file');
    const uploadChecked = assert.rejects(upload);
    stream.write('partial');
    await new Promise((resolve) => setTimeout(resolve, 20));
    sessions.closeOwned('owner', created.id);
    await Promise.all([checked, uploadChecked]);
    assert.equal(sessions.sessions.size, 0);
    assert.deepEqual(await readdir(path.join(data, 'adb-transfers')), []);
  } finally {
    await sessions.close();
    if (previous === undefined) delete process.env.DESKICONS_ADB_PATH;
    else process.env.DESKICONS_ADB_PATH = previous;
    await rm(data, { recursive: true, force: true });
  }
});
test('rapid reconnect serializes an old disconnect before creating the replacement session', async () => {
  const { AdbSessions } = await import('../server/adb/service.js');
  const data = await mkdtemp(path.join(os.tmpdir(), 'adb-race-'));
  const sessions = new AdbSessions(process.cwd(), data);
  const events = [];
  sessions.runtime.run = async (_owner, args) => {
    events.push(args[0]);
    if (args[0] === 'disconnect') await new Promise((r) => setTimeout(r, 25));
    return args[0] === 'connect'
      ? 'connected to device'
      : args.includes('get-state')
        ? 'device'
        : '';
  };
  try {
    const c = {
      ...validateAdbConnection({ protocol: 'adb', name: 'phone', host: 'phone.local', port: 5555 }),
      id: 'adb-test',
      ownerUid: 'owner',
    };
    const first = await sessions.create('owner', c, 'http://nas');
    events.length = 0;
    sessions.closeOwned('owner', first.id);
    const replacement = await sessions.create('owner', c, 'http://nas');
    assert.deepEqual(events, ['disconnect', 'connect', '-s']);
    assert.equal(sessions.get('owner', replacement.id).serial, 'phone.local:5555');
  } finally {
    await sessions.close();
    await rm(data, { recursive: true, force: true });
  }
});
