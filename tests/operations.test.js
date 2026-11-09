import { seedPowerConnections } from './fixtures/power-connections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../server/persistence/database.service.js';
import { OperationRepository } from '../server/persistence/operation.repository.js';
import { OperationService } from '../server/operations/service.js';
import { BackupService } from '../server/backup/service.js';
import { SessionFiles } from '../server/terminal/files.js';
import { AiConversationService } from '../server/terminal/ai/conversation.js';
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'operations-'));
  const db = new DatabaseService(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const repo = new OperationRepository(db);
  return { db, repo, service: new OperationService(repo) };
}
test('operation summaries isolate owners, filter, validate, and retain terminal rows only', (t) => {
  const { db, repo } = fixture(t);
  assert.equal(repo.settings('a').retention, 1000);
  repo.saveSettings('a', 100);
  assert.equal(repo.settings('b').retention, 1000);
  const running = repo.begin('a', 'ssh.delete', 'file\u0000\n' + 'a'.repeat(200));
  for (let i = 0; i < 103; i++) {
    const id = repo.begin('a', 'ai.command', 'session');
    repo.finish(id, 'a', i % 2 ? 'failed' : 'success', '固定摘要');
  }
  repo.begin('b', 'device.reboot', 'private device');
  assert.equal(repo.list('a', 1, 100).total, 101);
  assert.equal(repo.list('b').total, 1);
  assert.equal(repo.list('a', 1, 10, 'ssh.delete').items[0].id, running);
  assert.equal(repo.list('a', 1, 10, 'ssh.delete').items[0].target.length, 120);
  assert.ok(!JSON.stringify(repo.list('a')).includes('private device'));
  assert.throws(() => repo.list('a', 1, 10, 'secret'));
  assert.throws(() => repo.saveSettings('a', 0));
  assert.throws(() => db.connection.prepare("INSERT INTO operation_settings VALUES('c',7)").run());
  repo.finish(running, 'b', 'success', 'no');
  assert.equal(repo.list('a', 1, 10, 'ssh.delete').items[0].status, 'running');
});
test('recovery marks unknown outcomes interrupted and never claims external success', (t) => {
  const { repo } = fixture(t);
  repo.begin('a', 'device.shutdown', 'desktop');
  repo.recover();
  const r = repo.list('a').items[0];
  assert.equal(r.status, 'interrupted');
  assert.ok(r.finishedAt);
  assert.match(r.summary, /未知/);
});
test('record begin failure prevents side effect; finalization failure preserves actual result once', async (t) => {
  const { repo, service } = fixture(t);
  let calls = 0;
  repo.finish = () => {
    throw Error('SECRET /full/path');
  };
  const result = await service.run('a', 'ssh.delete', 'file', async () => {
    calls++;
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(calls, 1);
  assert.equal(repo.list('a').items[0].status, 'running');
  repo.begin = () => {
    throw Error('cannot audit');
  };
  await assert.rejects(service.run('a', 'ssh.delete', 'file', async () => calls++));
  assert.equal(calls, 1);
});
test('SSH hooks audit after path validation and avoid full paths/raw errors', async (t) => {
  const { repo, service } = fixture(t);
  const files = new SessionFiles({});
  t.after(() => files.close());
  files.audit = { owner: 'a', service };
  files.exists = async () => false;
  files.call = async (method) => {
    if (method === 'lstat') return { isDirectory: () => false };
    if (method === 'unlink') throw Error('secret /private/dir');
  };
  await files.rename('/private/dir', 'old', 'new');
  await assert.rejects(files.remove('/private/dir', 'old'));
  await assert.rejects(files.rename('/private/dir', '../foreign', 'new'));
  const rows = repo.list('a');
  assert.equal(rows.total, 2);
  assert.ok(rows.items.some((r) => r.status === 'success'));
  assert.ok(rows.items.some((r) => r.status === 'interrupted'));
  assert.ok(!JSON.stringify(rows).includes('/private'));
  assert.ok(!JSON.stringify(rows).includes('secret'));
});
test('restore commits exactly one operation with idempotent receipt, and record failure rolls back configuration', async (t) => {
  const { db, repo } = fixture(t);
  const backups = new BackupService(db, 'test');
  const pkg = {
    format: 'fnos-manager-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: 'test',
    includeCredentials: false,
    items: [
      {
        kind: 'connections',
        id: 'a'.repeat(24),
        data: {
          name: 'server',
          kind: 'remote',
          host: '192.168.1.2',
          port: 22,
          username: 'root',
          folderId: null,
        },
      },
    ],
  };
  const p = await backups.preview('a', pkg);
  const input = { token: p.token, requestId: 'request-1234567890', decisions: [] };
  const result = await backups.restore('a', input);
  assert.deepEqual(await backups.restore('a', input), result);
  assert.equal(repo.list('a').total, 1);
  assert.equal(repo.list('a').items[0].action, 'backup.restore');
  const next = await backups.preview('b', pkg);
  backups.audit.finish = () => {
    throw Error('fail commit');
  };
  await assert.rejects(backups.restore('b', { ...input, token: next.token }));
  assert.equal(repo.list('b').total, 0);
  assert.equal(
    db.connection.prepare("SELECT count(*) n FROM ssh_connections WHERE owner_uid='b'").get().n,
    0,
  );
});
async function idle(service) {
  for (let i = 0; i < 100; i++) {
    if (!service.snapshot('a', 's').busy) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('timeout');
}
for (const mode of ['silent', 'confirmed'])
  test(`AI ${mode} execution audits once with private command/output excluded`, async (t) => {
    const { repo, service } = fixture(t);
    let requests = 0,
      calls = 0;
    const ai = new AiConversationService({
      operations: service,
      settings: {
        privateSettings: () => ({
          baseUrl: 'http://mock/v1',
          model: 'fixture',
          apiKey: 'secret',
          updatedAt: 0,
        }),
      },
      provider: {
        complete: async () =>
          requests++
            ? { content: 'done', toolCalls: [] }
            : {
                content: '',
                toolCalls: [{ id: 'call', command: 'echo PRIVATE_COMMAND', explanation: 'why' }],
              },
      },
      getSession: (owner) => {
        if (owner !== 'a') throw Error('foreign');
        return { client: null, state: 'connected', closed: false };
      },
      execute: async () => {
        calls++;
        return {
          stdout: 'PRIVATE_OUTPUT',
          stderr: '',
          status: 'success',
          exitCode: 0,
          truncated: false,
        };
      },
    });
    t.after(() => ai.close());
    ai.message('a', 's', 'inspect', { executionMode: mode === 'silent' ? 'silent' : 'review' });
    await idle(ai);
    if (mode === 'confirmed') {
      const p = ai.snapshot('a', 's').proposals[0];
      assert.equal(repo.list('a').total, 0);
      ai.execute('a', 's', p.proposalId);
      await idle(ai);
    }
    assert.equal(calls, 1);
    assert.equal(repo.list('a').total, 1);
    assert.equal(repo.list('a').items[0].status, 'success');
    assert.ok(!JSON.stringify(repo.list('a')).includes('PRIVATE'));
  });
import { appFixture } from './fixtures/terminal-app.js';
import { DuplicateService } from '../server/storage/duplicates.js';
import { BatchRenameService } from '../server/storage/rename.js';
import { StorageService } from '../server/storage/service.js';
import { WakeService } from '../server/wol.js';
import { mkdir, realpath, writeFile, rename as renameFile } from 'node:fs/promises';
test('operations API enforces owner, CSRF, settings and query validation', async () => {
  const f = await appFixture();
  try {
    const call = (suffix = '', method = 'GET', body, headers = {}) =>
      fetch(f.base + '/operations' + suffix, {
        method,
        headers: { ...f.headers, ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal(
      (await call('/settings', 'PUT', { retention: 100 }, { 'x-deskicons-token': 'bad' })).status,
      403,
    );
    assert.equal((await call('/settings', 'PUT', { retention: 3 })).status, 400);
    assert.equal((await call('/settings', 'PUT', { retention: 100 })).status, 200);
    assert.equal(
      (await (await call('/settings', 'GET', undefined, { 'x-trim-userid': '1001' })).json())
        .retention,
      1000,
    );
    assert.equal((await call('?action=other')).status, 400);
    assert.equal((await call('?page=0')).status, 400);
    assert.equal((await (await call()).json()).total, 0);
  } finally {
    await f.close();
  }
});
test('duplicate batch audits partial and failed actual outcomes, rejects foreign owner before audit', async (t) => {
  const { db, repo, service } = fixture(t);
  const dir = await realpath(db.dataDir);
  await mkdir(dir + '/files');
  const job = {
    id: 'scan',
    owner: 'a',
    path: dir + '/files',
    mode: 'duplicates',
    status: 'completed',
    result: { groups: [{ size: 1, paths: ['keep', 'one', 'two'] }] },
  };
  const storage = {
    jobs: new Map([['scan', job]]),
    get: (owner) => {
      if (owner !== 'a') throw Error('foreign');
      return job;
    },
    resolve: async (v) => v,
    persist: async () => {},
  };
  const d = new DuplicateService(storage, service);
  t.after(() => d.close());
  let pass = 0;
  d.worker = async () => ({
    results: [
      { path: 'one', keep: 'keep', success: pass++ === 0 },
      { path: 'two', keep: 'keep', success: false, error: 'secret' },
    ],
  });
  const input = {
    action: 'delete',
    confirmed: true,
    items: [
      { keep: 'keep', path: 'one' },
      { keep: 'keep', path: 'two' },
    ],
  };
  await assert.rejects(d.process('b', 'scan', input));
  assert.equal(repo.list('a').total, 0);
  await d.process('a', 'scan', input);
  assert.equal(repo.list('a').items[0].status, 'partial');
  job.duplicateActions = [];
  await d.process('a', 'scan', input);
  assert.ok(repo.list('a').items.some((r) => r.status === 'failed'));
  assert.ok(!JSON.stringify(repo.list('a')).includes(dir));
});
test('rename and undo audit actual results and counts, without storing directory', async (t) => {
  const { db, repo } = fixture(t);
  const dir = await realpath(db.dataDir);
  await mkdir(dir + '/files');
  await writeFile(dir + '/files/a.txt', 'one');
  await writeFile(dir + '/files/b.txt', 'two');
  const storage = new StorageService({ roots: [dir + '/files'] });
  const rename = await new BatchRenameService({ dataDir: dir, database: db, storage }).init();
  t.after(async () => {
    await rename.close();
    await storage.close();
  });
  const p = await rename.preview('a', {
    path: dir + '/files',
    names: ['a.txt', 'b.txt'],
    rules: { prefix: 'new-' },
  });
  const result = await rename.execute('a', p.id, { confirmed: true });
  assert.equal(result.status, 'completed');
  await rename.undo('a', result.id, { confirmed: true });
  assert.deepEqual(
    new Set(repo.list('a').items.map((r) => r.action)),
    new Set(['storage.rename', 'storage.undo']),
  );
  assert.ok(repo.list('a').items.every((r) => r.status === 'success'));
  assert.ok(!JSON.stringify(repo.list('a')).includes(dir));
  const partial = await rename.preview('a', {
    path: dir + '/files',
    names: ['a.txt', 'b.txt'],
    rules: { prefix: 'partial-' },
  });
  rename.run = async () => {
    await renameFile(dir + '/files/a.txt', dir + '/files/partial-a.txt');
    throw Error('private');
  };
  await rename.execute('a', partial.id, { confirmed: true });
  assert.ok(repo.list('a').items.some((r) => r.status === 'partial'));
});
test('scheduled device power audits once per actual target and never persists address/error', async (t) => {
  const { db, repo } = fixture(t);
  seedPowerConnections(db.dataDir, { ['a'.repeat(24)]: {} }, 'a');
  let calls = 0;
  const power = {
    close() {},
    prepare: () => ({ connection: { host: 'PRIVATE_HOST' } }),
    execute: async () => {
      calls++;
    },
  };
  const wake = await new WakeService({
    dataDir: db.dataDir,
    database: db,
    power,
    terminalStore: { get: () => ({ kind: 'remote', hasCredentials: true }) },
  }).init();
  t.after(() => wake.close());
  const row = await wake.save('a', {
    name: 'desktop',
    mac: '02:11:22:33:44:55',
    address: '192.168.1.255',
    connectionId: 'a'.repeat(24),
  });
  await assert.rejects(
    wake.controlMany(
      'b',
      { ids: [row.id], action: 'reboot', confirmed: true },
      { scheduled: true },
    ),
  );
  assert.equal(calls, 0);
  await wake.controlMany(
    'a',
    { ids: [row.id], action: 'reboot', confirmed: true },
    { scheduled: true },
  );
  assert.equal(calls, 1);
  assert.equal(repo.list('a').items[0].action, 'device.reboot');
  assert.equal(repo.list('a').items[0].target, 'desktop');
  assert.ok(!JSON.stringify(repo.list('a')).includes('PRIVATE_HOST'));
});
for (const mode of ['silent', 'review'])
  test(`AI skill ${mode} audits execution, excluding resource reads and skill output`, async (t) => {
    const { repo, service } = fixture(t);
    let turns = 0,
      calls = 0;
    const { parseAiCall, splitAiCalls } = await import('../server/terminal/ai/tools.js');
    const split = splitAiCalls([
      parseAiCall('resource', 'read_skill_resource', {
        name: 'example',
        revision: 1,
        path: 'private/reference.md',
        offset: 0,
      }),
      parseAiCall('runtime', 'prepare_skill_runtime', {
        name: 'example',
        revision: 1,
        explanation: 'prepare',
      }),
    ]);
    const ai = new AiConversationService({
      operations: service,
      settings: {
        privateSettings: () => ({
          baseUrl: 'http://fixture',
          model: 'test',
          apiKey: '',
          updatedAt: 0,
        }),
      },
      getSession: () => ({ client: null, state: 'connected', closed: false }),
      skillActions: {
        bind: () => ({ skillId: 'x', packageId: 'p', revision: 1, sha256: 'a'.repeat(64) }),
        read: async () => ({ text: 'PRIVATE_REFERENCE' }),
        execute: async () => {
          calls++;
          return {
            stdout: 'PRIVATE_SKILL_OUTPUT',
            stderr: '',
            exitCode: 0,
            status: 'success',
            truncated: false,
          };
        },
      },
      provider: {
        complete: async () =>
          turns++ ? { content: 'done', toolCalls: [] } : { content: '', ...split },
      },
    });
    t.after(() => ai.close());
    ai.message('a', 's', 'use skill', { executionMode: mode });
    await idle(ai);
    if (mode === 'review') {
      assert.equal(repo.list('a').total, 0);
      ai.execute('a', 's', ai.snapshot('a', 's').proposals[0].proposalId);
      await idle(ai);
    }
    assert.equal(calls, 1);
    const rows = repo.list('a');
    assert.equal(rows.total, 1);
    assert.equal(rows.items[0].action, 'ai.skill');
    assert.equal(rows.items[0].status, 'success');
    assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  });
for (const [exitCode, expected] of [
  [null, 'interrupted'],
  [7, 'failed'],
])
  test(`AI failed result with exit ${exitCode} records ${expected}`, async (t) => {
    const { repo, service } = fixture(t);
    let turns = 0;
    const ai = new AiConversationService({
      operations: service,
      settings: {
        privateSettings: () => ({
          baseUrl: 'http://fixture',
          model: 'test',
          apiKey: '',
          updatedAt: 0,
        }),
      },
      getSession: () => ({ client: {}, state: 'connected', closed: false }),
      execute: async () => ({
        stdout: '',
        stderr: 'transport secret',
        exitCode,
        status: 'failed',
        truncated: exitCode === null,
      }),
      provider: {
        complete: async () =>
          turns++
            ? { content: 'done', toolCalls: [] }
            : { content: '', toolCalls: [{ id: 'call', command: 'command', explanation: 'run' }] },
      },
    });
    t.after(() => ai.close());
    ai.message('a', 's', 'run', { executionMode: 'silent' });
    await idle(ai);
    assert.equal(repo.list('a').items[0].status, expected);
  });
for (const [code, expected] of [
  [3, 'failed'],
  [4, 'failed'],
  ['ECONNRESET', 'interrupted'],
])
  test(`SFTP explicit rejection ${code} records ${expected}`, async (t) => {
    const { repo, service } = fixture(t);
    const files = new SessionFiles({});
    t.after(() => files.close());
    files.audit = { owner: 'a', service };
    files.call = async (method, ...args) =>
      method === 'lstat'
        ? { isDirectory: () => true }
        : files.perform(
            { rmdir: (_p, cb) => cb(Object.assign(new Error('secret'), { code })) },
            method,
            args,
          );
    await assert.rejects(files.remove('/private', 'directory'));
    assert.equal(repo.list('a').items[0].status, expected);
  });
import { EventEmitter } from 'node:events';
import { WakePower } from '../server/wake-power.js';
for (const [code, expected] of [
  [9, 'failed'],
  [null, 'interrupted'],
])
  test(`device exit ${code} records ${expected}`, async (t) => {
    const { repo, service } = fixture(t);
    const client = new EventEmitter();
    client.connect = () => queueMicrotask(() => client.emit('ready'));
    client.destroy = () => {};
    client.exec = (_command, callback) => {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      callback(null, stream);
      if (code !== null) stream.emit('exit', code);
      stream.emit('close');
    };
    const power = new WakePower(null, { clientFactory: () => client });
    t.after(() => power.close());
    await assert.rejects(
      service.run('a', 'device.reboot', 'desktop', () =>
        power.execute('a', {}, 'reboot', {
          connection: {},
          credentials: { method: 'password', password: 'private' },
          command: 'not executed',
        }),
      ),
    );
    assert.equal(repo.list('a').items[0].status, expected);
  });
test('rename registration failure leaves no journal and preserves preview for retry', async (t) => {
  const { db, repo } = fixture(t);
  const dir = await realpath(db.dataDir);
  await mkdir(dir + '/files');
  await writeFile(dir + '/files/a.txt', 'one');
  const storage = new StorageService({ roots: [dir + '/files'] });
  const rename = await new BatchRenameService({ dataDir: dir, database: db, storage }).init();
  t.after(async () => {
    await rename.close();
    await storage.close();
  });
  const p = await rename.preview('a', {
    path: dir + '/files',
    names: ['a.txt'],
    rules: { prefix: 'new-' },
  });
  let calls = 0;
  const run = rename.run.bind(rename);
  rename.run = async (...args) => {
    calls++;
    return run(...args);
  };
  const begin = rename.audit.begin.bind(rename.audit);
  rename.audit.begin = () => {
    throw Error('audit insertion failed');
  };
  await assert.rejects(rename.execute('a', p.id, { confirmed: true }));
  assert.equal(calls, 0);
  assert.equal(rename.records.length, 0);
  assert.equal(rename.repository.list().length, 0);
  assert.ok(rename.previews.has(p.id));
  assert.equal(repo.list('a').total, 0);
  rename.audit.begin = begin;
  const save = rename.repository.save.bind(rename.repository);
  rename.repository.save = () => {
    throw Error('journal insertion failed');
  };
  await assert.rejects(rename.execute('a', p.id, { confirmed: true }));
  assert.equal(calls, 0);
  assert.equal(repo.list('a').total, 0);
  assert.ok(rename.previews.has(p.id));
  rename.repository.save = save;
  const result = await rename.execute('a', p.id, { confirmed: true });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 1);
  assert.equal(repo.list('a').total, 1);
});
