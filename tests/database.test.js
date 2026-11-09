import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../server/persistence/database.service.js';
import { upgradeDatabase } from '../server/upgrade/v1-to-v2.js';
import { randomBytes } from 'node:crypto';
import { sealLegacy } from './fixtures/legacy-credentials.js';
import { TerminalStore } from '../server/terminal/store.js';
test('runtime refuses old JSON instead of starting with an empty database', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-json-rejected-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = '[{"id":"keep"}]';
  await writeFile(path.join(dir, 'entries.json'), original);
  assert.throws(() => new DatabaseService(dir), /旧数据/);
  assert.equal(await readFile(path.join(dir, 'entries.json'), 'utf8'), original);
});
test('upgrade converts legacy SSH ciphertext to plaintext without runtime key', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-v2-secret-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keyDir = path.join(dir, 'old-terminal');
  await mkdir(keyDir);
  const key = randomBytes(32);
  await writeFile(path.join(keyDir, 'credential.key'), key);
  const connection = {
    id: 'saved',
    ownerUid: '1000',
    host: '127.0.0.1',
    port: 22,
    username: 'tester',
    name: 'old',
    kind: 'local',
    authMethod: 'password',
  };
  connection.credentialBox = sealLegacy(
    { method: 'password', password: 'legacy-secret' },
    connection,
    key,
  );
  const source = path.join(dir, 'source.sqlite'),
    db = new DatabaseSync(source);
  db.exec(
    'PRAGMA user_version=1;CREATE TABLE documents(path TEXT PRIMARY KEY,metadata TEXT);CREATE TABLE ssh_connections(id TEXT PRIMARY KEY,position INTEGER,payload TEXT)',
  );
  db.prepare('INSERT INTO ssh_connections VALUES(?,?,?)').run(
    connection.id,
    0,
    JSON.stringify(connection),
  );
  db.close();
  const output = path.join(dir, 'new');
  await upgradeDatabase(source, path.join(output, 'nas-manager.sqlite'), {
    credentialKeyPath: path.join(keyDir, 'credential.key'),
  });
  const store = await new TerminalStore(output).init();
  assert.equal(store.getCredentials('1000', 'saved').password, 'legacy-secret');
  assert.throws(() => store.getCredentials('1001', 'saved'));
  assert.deepEqual(await readFile(path.join(keyDir, 'credential.key')), key);
  assert.equal(store.get('1000', 'saved').credentials.password, 'legacy-secret');
  assert.ok(
    (await readFile(path.join(output, 'nas-manager.sqlite'))).includes(
      Buffer.from('legacy-secret'),
    ),
  );
});
test('legacy conversion refuses an unavailable key and leaves source untouched', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-upgrade-key-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.sqlite'),
    destination = path.join(dir, 'v2', 'nas-manager.sqlite');
  const c = {
    id: 'secret',
    ownerUid: '1000',
    name: 'old',
    kind: 'remote',
    host: 'nas',
    port: 22,
    username: 'tester',
    authMethod: 'password',
  };
  c.credentialBox = sealLegacy(
    { method: 'password', password: 'legacy-secret' },
    c,
    randomBytes(32),
  );
  const db = new DatabaseSync(source);
  db.exec(
    'PRAGMA user_version=1;CREATE TABLE documents(path TEXT PRIMARY KEY,metadata TEXT);CREATE TABLE ssh_connections(id TEXT PRIMARY KEY,position INTEGER,payload TEXT)',
  );
  db.prepare('INSERT INTO ssh_connections VALUES(?,?,?)').run(c.id, 0, JSON.stringify(c));
  db.close();
  const before = await readFile(source);
  await assert.rejects(() => upgradeDatabase(source, destination), /ssh_connections\/secret/);
  assert.deepEqual(await readFile(source), before);
  await assert.rejects(() => readFile(destination), { code: 'ENOENT' });
});
