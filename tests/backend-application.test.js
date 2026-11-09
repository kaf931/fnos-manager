import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageService } from '../server/app/storage/storage.service.js';
import { Resources } from '../server/app/common/resources.js';
import { IconsService } from '../server/app/icons/icons.service.js';

test('storage shutdown is idempotent and drains every worker before database even on failure', async () => {
  const order = [];
  const failure = new Error('duplicate shutdown failed');
  const storage = new StorageService(
    {
      close: async () => {
        order.push('scanner');
      },
    },
    {
      close: async () => {
        order.push('duplicates');
        throw failure;
      },
    },
    {
      close: async () => {
        order.push('rename');
      },
    },
  );
  const resources = new Resources();
  resources.add('storageService', storage);
  resources.add('database', {
    close: () => {
      order.push('database');
    },
  });
  const close = resources.close();
  assert.equal(resources.close(), close);
  await assert.rejects(close, AggregateError);
  await assert.rejects(storage.close(), AggregateError);
  assert.deepEqual(order, ['duplicates', 'rename', 'scanner', 'database']);
});

test('icon service creates and revises icons while preserving applied revision', async () => {
  const entries = new Map();
  const store = {
    get entries() {
      return [...entries.values()];
    },
    save: (entry) => entries.set(entry.id, entry),
    find: (id) => entries.get(id),
  };
  const service = new IconsService(
    '/tmp',
    false,
    'csrf',
    'test',
    store,
    (id) => {
      if (!entries.has(id)) throw new Error('missing');
      return entries.get(id);
    },
    async () => Buffer.from('image'),
    async (_id, operation) => operation(),
  );
  const entry = await service.createEntry({ name: 'Example', url: 'https://example.com' });
  assert.equal(entry.revision, 1);
  assert.equal(entry.appliedRevision, 0);
  const updated = await service.updateEntry(entry.id, {
    name: 'Changed',
    url: 'https://example.com',
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.appliedRevision, 0);
  assert.equal((await service.listEntries())[0].name, 'Changed');
});

test('resource shutdown attempts all services after an early failure and closes database last', async () => {
  const order = [];
  const resources = new Resources();
  for (const name of [
    'taskEngine',
    'wakeService',
    'storageService',
    'aiService',
    'terminalService',
    'database',
  ]) {
    resources.add(name, {
      close: async () => {
        order.push(name);
        if (name === 'taskEngine' || name === 'terminalService') throw new Error(name);
      },
    });
  }
  await assert.rejects(
    resources.close(),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  assert.deepEqual(order, [
    'taskEngine',
    'wakeService',
    'storageService',
    'aiService',
    'terminalService',
    'database',
  ]);
});

test('task application operations keep device tasks private to their owner', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { WakeService } = await import('../server/wol.js');
  const { TasksService } = await import('../server/app/tasks/tasks.service.js');
  const dir = await mkdtemp(tmpdir() + '/task-application-');
  const resources = new Resources();
  const database = resources.add('database', new DatabaseService(dir));
  try {
    const wake = resources.add(
      'wakeService',
      await new WakeService({ dataDir: dir, database }).init(),
    );
    const device = await wake.save('1000', {
      name: 'Computer',
      mac: '02:11:22:33:44:55',
      address: '192.168.1.255',
      port: 9,
    });
    const tasks = await TasksService.create(
      { dataDir: dir, root: process.cwd(), gateway: true, startScheduler: false },
      { service: wake },
      resources,
      database,
    );
    const owner = (uid, id) => ({
      headers: { 'x-trim-isadmin': 'true', 'x-trim-userid': uid },
      params: { id },
      query: {},
    });
    const input = {
      name: 'Wake',
      type: 'device-wake',
      deviceIds: [device.id],
      enabled: false,
      schedule: { kind: 'interval', minutes: 1 },
    };
    const task = await tasks.createTask(owner('1000'), input);
    assert.equal(task.ownerUid, '1000');
    assert.equal((await tasks.listTasks(owner('1000'))).length, 1);
    assert.deepEqual(await tasks.listTasks(owner('1001')), []);
    const foreign = owner('1001', task.id);
    for (const operation of [
      () => tasks.updateTask(foreign, input),
      () => tasks.removeTask(foreign),
      () => tasks.runTask(foreign, { confirmed: true }),
      () => tasks.previewTask(foreign),
      () => tasks.taskRuns(foreign),
    ])
      await assert.rejects(operation(), (error) => error.status === 404);
    assert.equal((await tasks.listTasks(owner('1000'))).length, 1);
  } finally {
    await resources.close();
    await rm(dir, { recursive: true, force: true });
  }
});
