import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-ssh-repo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { TerminalRepository } = await import('../server/persistence/terminal.repository.js');
  const { WorkspaceRepository } = await import('../server/persistence/workspace.repository.js');
  const { WakeRepository } = await import('../server/persistence/wake.repository.js');
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  return {
    db,
    terminal: new TerminalRepository(db),
    workspace: new WorkspaceRepository(db),
    wake: new WakeRepository(db),
  };
}
test('connection updates retain bindings and owner checks prevent cross-user writes', async (t) => {
  const { db, terminal, wake } = await fixture(t);
  const connection = {
    id: 'ssh',
    ownerUid: '1000',
    name: 'nas',
    kind: 'remote',
    host: 'nas',
    port: 22,
    username: 'user',
    folderId: null,
    authMethod: 'password',
    credentials: { method: 'password', password: 'fixture-secret' },
  };
  terminal.save(connection);
  wake.save({
    id: 'pc',
    owner: '1000',
    name: 'PC',
    mac: 'AA:BB:CC:DD:EE:FF',
    address: '192.168.1.255',
    port: 9,
    system: 'linux',
    connectionId: 'ssh',
  });
  terminal.save({ ...connection, name: 'renamed' });
  assert.equal(wake.find('1000', 'pc').connectionId, 'ssh');
  assert.throws(() => terminal.save({ ...connection, ownerUid: '1001' }));
  assert.equal(terminal.find('1001', 'ssh'), undefined);
  terminal.remove('1001', 'ssh');
  assert.ok(terminal.find('1000', 'ssh'));
  terminal.remove('1000', 'ssh');
  assert.equal(wake.find('1000', 'pc').connectionId, null);
  assert.deepEqual(db.connection.prepare('PRAGMA foreign_key_check').all(), []);
});
test('workspace refuses cycles, scope mismatch and deleting a populated directory', async (t) => {
  const { workspace, terminal } = await fixture(t);
  const folder = {
    id: 'parent',
    ownerUid: '1000',
    scope: 'assets',
    kind: 'folder',
    name: '分类',
    parentId: null,
  };
  workspace.save(folder);
  workspace.save({ ...folder, id: 'child', parentId: 'parent' });
  assert.throws(() => workspace.save({ ...folder, parentId: 'child' }), /循环/);
  assert.throws(() =>
    workspace.save({ ...folder, id: 'wrong', scope: 'commands', parentId: 'parent' }),
  );
  assert.throws(() => workspace.remove('1000', 'parent'));
  workspace.remove('1000', 'child');
  terminal.save({
    id: 'ssh',
    ownerUid: '1000',
    name: 'nas',
    kind: 'remote',
    host: 'nas',
    port: 22,
    username: 'user',
    folderId: 'parent',
  });
  assert.throws(() => workspace.remove('1000', 'parent'));
});
test('known host identity has composite uniqueness and updates do not duplicate rows', async (t) => {
  const { terminal } = await fixture(t);
  const key = {
    ownerUid: '1000',
    host: 'nas',
    port: 22,
    algorithm: 'ed25519',
    key: 'public',
    fingerprint: 'SHA256:a',
  };
  terminal.trust(key);
  terminal.trust({ ...key, key: 'new', fingerprint: 'SHA256:b' });
  assert.equal(terminal.hostKeys('1000', 'nas', 22).length, 1);
  assert.equal(terminal.hostKeys('1000', 'nas', 22)[0].key, 'new');
  assert.equal(terminal.hostKeys('1001', 'nas', 22).length, 0);
});
