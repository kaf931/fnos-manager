import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { VncRepository } from '../server/persistence/vnc.repository.js';
import { validateVncConnection } from '../server/vnc/model.js';
import { VncTransport } from '../server/vnc/transport.js';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
test('VNC connections validate, persist and isolate users without altering SSH', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnc-'));
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const repo = new VncRepository(db);
  const input = {
    name: '屏幕共享',
    protocol: 'vnc',
    host: '192.168.1.8',
    port: 5900,
    username: '',
    password: 'secret',
  };
  const row = repo.save('a', input);
  assert.equal(row.protocol, 'vnc');
  assert.equal(repo.list('a').length, 1);
  assert.equal(repo.list('b').length, 0);
  assert.throws(() => repo.get('b', row.id), /不存在/);
  assert.throws(() => repo.save('b', input, row.id), /不存在/);
  assert.equal(repo.save('a', { ...input, password: '' }, row.id).password, 'secret');
  assert.throws(() => validateVncConnection({ ...input, host: 'host;curl bad' }));
  assert.throws(() => validateVncConnection({ ...input, protocol: 'rdp' }));
  assert.throws(() => validateVncConnection({ ...input, port: 0 }));
  assert.equal(db.connection.prepare('select count(*) n from ssh_connections').get().n, 0);
  assert.equal(db.connection.prepare('pragma foreign_key_check').all().length, 0);
  assert.throws(() => repo.save('a', { ...input, folderId: 'foreign' }), /目录/);
  repo.remove('b', row.id);
  assert.equal(repo.list('a').length, 1);
  repo.remove('a', row.id);
  assert.equal(repo.list('a').length, 0);
});
test('VNC relay authenticates owner/origin tickets, relays binary bytes and cleans up', async (t) => {
  const target = tcpServer((s) => {
    s.write(Buffer.from('RFB 003.008\n'));
    s.on('data', (data) => s.write(data));
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const server = httpServer(),
    relay = new VncTransport(false);
  relay.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    relay.close();
    server.close();
    target.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port,
    connection = {
      id: 'vnc-test',
      ownerUid: 'development',
      name: 'test',
      protocol: 'vnc',
      host: '127.0.0.1',
      port: target.address().port,
      username: '',
      password: '',
      folderId: null,
    };
  const denied = relay.create('development', connection, origin);
  const bad = new WebSocket(
    origin.replace('http:', 'ws:') + '/app/deskicons/vnc/ws?ticket=' + denied.ticket,
    { origin: 'http://wrong' },
  );
  const [error] = await once(bad, 'error');
  assert.match(error.message, /403/);
  assert.equal(relay.sessions.size, 1);
  const url = origin.replace('http:', 'ws:') + '/app/deskicons/vnc/ws?ticket=' + denied.ticket;
  const ws = new WebSocket(url, { origin });
  const greeting = once(ws, 'message');
  await once(ws, 'open');
  assert.equal((await greeting)[0].toString(), 'RFB 003.008\n');
  const logs = relay.logs.read('development', denied.id);
  assert.ok(logs.some((row) => /目标 TCP 连接成功，用时 \d+ ms/.test(row.message)));
  assert.ok(logs.some((row) => row.message.includes('RFB 003.008')));
  const response = once(ws, 'message');
  ws.send(Buffer.from([0, 1, 2, 255]));
  assert.deepEqual((await response)[0], Buffer.from([0, 1, 2, 255]));
  const replay = new WebSocket(url, { origin });
  await once(replay, 'error');
  assert.throws(() => relay.closeOwned('other', denied.id), /不存在/);
  const closed = once(relay.sessions.get(denied.id).ws, 'close');
  ws.close();
  await closed;
  assert.equal(relay.sessions.size, 0);
  const finalLogs = relay.logs.read('development', denied.id);
  assert.ok(finalLogs.some((row) => row.stage === 'disconnect'));
  const performance = finalLogs.find(
    (row) => row.stage === 'performance' && row.message.includes('目标→NAS'),
  );
  assert.match(performance.message, /NAS→WebSocket.*待发送.*最长发送等待.*心跳往返/);
  assert.equal(relay.sessions.size, 0);
  relay.closeOwned('development', denied.id);
  assert.throws(() => relay.logs.read('development', denied.id), /不存在/);
});

test('VNC settings join connection backup, strip passwords and restore folders atomically', async (t) => {
  const { BackupService } = await import('../server/backup/service.js');
  const { WorkspaceRepository } = await import('../server/persistence/workspace.repository.js');
  const { randomUUID } = await import('node:crypto');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vnc-backup-')),
    db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  new WorkspaceRepository(db).save({
    id: 'folder',
    ownerUid: 'a',
    kind: 'folder',
    scope: 'assets',
    name: 'VNC',
    parentId: null,
  });
  const repo = new VncRepository(db),
    service = new BackupService(db, 'test');
  repo.save('a', {
    name: 'Desktop',
    protocol: 'vnc',
    host: '192.168.1.8',
    port: 5900,
    password: 'secret-vnc',
    folderId: 'folder',
  });
  const pkg = await service.export('a', { modules: ['ssh'], includeCredentials: false });
  assert.equal(pkg.items.find((i) => i.kind === 'vnc').data.password, '');
  assert.equal(
    pkg.items.some((i) => i.kind === 'folders'),
    true,
  );
  const full = await service.export('a', { modules: ['ssh'], includeCredentials: true });
  assert.equal(full.items.find((i) => i.kind === 'vnc').data.password, 'secret-vnc');
  const preview = await service.preview('b', pkg);
  await service.restore('b', { token: preview.token, requestId: randomUUID(), decisions: [] });
  const restored = repo.list('b')[0];
  assert.equal(restored.password, '');
  assert.notEqual(restored.folderId, 'folder');
  assert.ok(
    db.connection
      .prepare('SELECT id FROM ssh_folders WHERE owner_uid=? AND id=?')
      .get('b', restored.folderId),
  );
});

test('VNC may connect without saved password while SSH still requires credentials', async () => {
  const { requiresSavedCredentials, connectionPath } =
    await import('../.web-test/remote-connections.js');
  assert.equal(requiresSavedCredentials({ protocol: 'vnc', hasCredentials: false }), false);
  assert.equal(requiresSavedCredentials({ protocol: 'ssh', hasCredentials: false }), true);
  assert.equal(requiresSavedCredentials({ hasCredentials: false }), true);
  assert.equal(requiresSavedCredentials({ protocol: 'ssh', hasCredentials: true }), false);
  assert.equal(connectionPath({ protocol: 'vnc' }), '/vnc/connections');
  assert.equal(connectionPath({ protocol: 'ssh' }), '/terminal/connections');
});

test('ADB connections load with the other protocols and do not require SSH credentials', async () => {
  const { loadConnections, requiresSavedCredentials, connectionPath } =
    await import('../.web-test/remote-connections.js');
  const paths = [];
  const rows = await loadConnections(async (path) => {
    paths.push(path);
    return path === '/adb/connections'
      ? [
          {
            id: 'adb-one',
            protocol: 'adb',
            name: 'Android',
            host: '192.168.1.20',
            port: 5555,
            transport: 'tcp',
            serial: '',
          },
        ]
      : [];
  });
  assert.equal(paths.includes('/adb/connections'), true);
  assert.equal(rows[0]?.protocol, 'adb');
  assert.equal(requiresSavedCredentials({ protocol: 'adb', hasCredentials: false }), false);
  assert.equal(connectionPath({ protocol: 'adb' }), '/adb/connections');
});
