import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-task-repo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { DatabaseService } = await import('../server/persistence/database.service.js');
  const { TaskRepository } = await import('../server/persistence/task.repository.js');
  const db = new DatabaseService(dir);
  t.after(() => db.close());
  return { db, repo: new TaskRepository(db) };
}
const task = {
  id: 'task',
  name: '检查',
  type: 'script',
  enabled: false,
  acknowledged: false,
  schedule: { kind: 'daily', time: '03:00' },
  timeoutSeconds: 300,
  script: 'date',
  nextRunAt: null,
};
test('task runs preserve state, update atomically and disappear with their task', async (t) => {
  const { db, repo } = await fixture(t);
  repo.save(task);
  const run = {
    id: 'run',
    taskId: 'task',
    taskName: '检查',
    trigger: 'manual',
    status: 'running',
    startedAt: '2026-10-20T00:00:00.000Z',
    stdout: '',
    stderr: '',
  };
  repo.saveRun(run);
  db.connection.exec(
    "CREATE TRIGGER reject_run BEFORE UPDATE ON task_runs BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  assert.throws(
    () =>
      repo.transaction(() => {
        repo.save({ ...task, name: 'changed' });
        repo.saveRun({ ...run, status: 'success', code: 0 });
      }),
    /fixture failure/,
  );
  assert.equal(repo.find('task').name, '检查');
  assert.equal(repo.history('task').items[0].status, 'running');
  db.connection.exec('DROP TRIGGER reject_run');
  repo.saveRun({ ...run, status: 'success', code: 0 });
  assert.equal(repo.history('task').items[0].code, 0);
  repo.remove('task');
  assert.equal(repo.history('task').total, 0);
});
test('device association belongs to task owner and invalid update rolls back', async (t) => {
  const { db, repo } = await fixture(t);
  db.connection
    .prepare(
      'INSERT INTO wake_devices(id,owner_uid,name,mac,address,port,system) VALUES(?,?,?,?,?,?,?)',
    )
    .run('pc', '1000', 'PC', 'AA:BB:CC:DD:EE:FF', '192.168.1.255', 9, 'linux');
  const deviceTask = { ...task, type: 'device-wake', ownerUid: '1000', deviceIds: ['pc'] };
  repo.save(deviceTask);
  assert.throws(() => repo.save({ ...deviceTask, deviceIds: ['missing'] }));
  assert.deepEqual(repo.find('task').deviceIds, ['pc']);
  assert.throws(() => repo.save({ ...deviceTask, ownerUid: '1001' }));
});
test('history pagination is stable for equal timestamps', async (t) => {
  const { repo } = await fixture(t);
  repo.save(task);
  for (let i = 0; i < 12; i++)
    repo.saveRun({
      id: `run${String(i).padStart(2, '0')}`,
      taskId: 'task',
      taskName: '检查',
      trigger: 'manual',
      status: 'success',
      startedAt: '2026-10-20T00:00:00.000Z',
      stdout: '',
      stderr: '',
      code: 0,
    });
  const first = repo.history('task', { page: 1, pageSize: 5 }),
    second = repo.history('task', { page: 2, pageSize: 5 });
  assert.equal(first.total, 12);
  assert.equal(first.items.length, 5);
  assert.equal(new Set([...first.items, ...second.items].map((r) => r.id)).size, 10);
});

test('history retention never deletes an in-flight execution', async (t) => {
  const { repo } = await fixture(t);
  repo.save(task);
  const run = {
    id: 'active',
    taskId: task.id,
    taskName: task.name,
    trigger: 'manual',
    status: 'running',
    startedAt: '2026-10-20T00:00:00.000Z',
    stdout: '',
    stderr: '',
  };
  repo.saveRun(run);
  for (let i = 1; i <= 101; i++)
    repo.saveRun({
      ...run,
      id: 'done-' + i,
      status: 'success',
      startedAt: new Date(Date.parse(run.startedAt) + i * 1000).toISOString(),
    });
  repo.trimHistory();
  assert.equal(repo.history().total, 101);
  assert.equal(repo.history(undefined, { page: 2, pageSize: 100 }).items[0].id, 'active');
});
