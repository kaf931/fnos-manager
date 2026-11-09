import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
const model = await import('../server/tasks/model.js').catch(() => ({}));
const engineModule = await import('../server/tasks/engine.js').catch(() => ({}));
const runnerModule = await import('../server/tasks/runner.js').catch(() => ({}));
test('daily and weekly schedules use Asia/Shanghai across UTC boundaries', () => {
  assert.equal(typeof model.nextRun, 'function');
  assert.equal(
    model.nextRun({ kind: 'daily', time: '00:15' }, new Date('2026-10-18T15:59:00Z')),
    '2026-10-18T16:15:00.000Z',
  );
  assert.equal(
    model.nextRun({ kind: 'weekly', time: '08:00', days: [1] }, new Date('2026-10-18T01:00:00Z')),
    '2026-10-19T00:00:00.000Z',
  );
});
test('task validation rejects unsupported built-ins, unsafe identifiers and invalid schedules', () => {
  assert.equal(typeof model.validateTask, 'function');
  for (const value of [
    { type: 'cache-clear' },
    { type: 'snapshot' },
    { type: 'app', target: 'deskicons', action: 'stop' },
    { type: 'app', target: 'a;reboot', action: 'start' },
    { type: 'script', script: 'echo ok', schedule: { kind: 'daily', time: '29:00' } },
  ])
    assert.throws(() =>
      model.validateTask({ name: '测试', schedule: { kind: 'interval', minutes: 5 }, ...value }),
    );
});
test('dangerous actions require explicit scope acknowledgment', () => {
  assert.equal(typeof model.validateTask, 'function');
  assert.throws(() =>
    model.validateTask({
      name: '重启',
      type: 'reboot',
      schedule: { kind: 'daily', time: '03:00' },
    }),
  );
  const value = model.validateTask({
    name: '重启',
    type: 'reboot',
    acknowledged: true,
    schedule: { kind: 'daily', time: '03:00' },
  });
  assert.equal(value.enabled, false);
});
test('runner builds only confirmed fixed official command arguments', () => {
  assert.equal(typeof runnerModule.describeAction, 'function');
  assert.deepEqual(runnerModule.describeAction({ type: 'trash-clear' }).args, [
    'file',
    'trash',
    'clear',
    '--yes',
  ]);
  assert.deepEqual(runnerModule.describeAction({ type: 'log-clear', level: 3, module: 1 }).args, [
    'logger',
    'clear',
    '--level',
    '3',
    '--module',
    '1',
    '--yes',
  ]);
  assert.deepEqual(runnerModule.describeAction({ type: 'reboot' }).args, [
    'power',
    'reboot',
    '--yes',
  ]);
});
test('script execution captures output and enforces timeout on the process group', async () => {
  assert.equal(typeof runnerModule.executeProcess, 'function');
  const result = await runnerModule.executeProcess('/bin/bash', ['-s'], {
    input: 'printf task-ok',
    timeoutMs: 2000,
  });
  assert.equal(result.stdout, 'task-ok');
  const failed = await runnerModule.executeProcess('/bin/bash', ['-s'], {
    input: 'sleep 5',
    timeoutMs: 80,
  });
  assert.equal(failed.timedOut, true);
});
test('scheduler claims a due task once and persists history', async () => {
  assert.equal(typeof engineModule.TaskEngine, 'function');
  const dir = await mkdtemp(os.tmpdir() + '/deskicons-sched-');
  let count = 0;
  try {
    const engine = await new engineModule.TaskEngine(dir, {
      runner: async () => {
        count++;
        await new Promise((r) => setTimeout(r, 30));
        return { stdout: 'done', code: 0 };
      },
    }).init();
    const task = await engine.create(
      {
        name: '测试脚本',
        type: 'script',
        script: 'echo done',
        enabled: true,
        schedule: { kind: 'interval', minutes: 1 },
      },
      new Date('2026-10-18T00:00:00Z'),
    );
    await Promise.all([
      engine.tick(new Date('2026-10-18T00:01:01Z')),
      engine.tick(new Date('2026-10-18T00:01:01Z')),
    ]);
    await engine.idle();
    assert.equal(count, 1);
    assert.equal(engine.history(task.id)[0].status, 'success');
    const reopened = await new engineModule.TaskEngine(dir, {
      runner: async () => {
        throw new Error('should not run');
      },
    }).init();
    assert.equal(reopened.history(task.id)[0].stdout, 'done');
    assert.ok(new Date(reopened.list()[0].nextRunAt) > new Date());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('timeout kills descendants that ignore TERM after their parent exits', async () => {
  const result = await runnerModule.executeProcess('/bin/bash', ['-s'], {
    input: `bash -c 'trap "" TERM; exec sleep 20' </dev/null >/dev/null 2>&1 &\nprintf '%s' "$!"\nwait`,
    timeoutMs: 150,
  });
  const pid = Number(result.stdout);
  assert.ok(pid > 1);
  assert.equal(result.timedOut, true);
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    alive = result.status === 0 && !result.stdout.trim().startsWith('Z');
  }
  try {
    assert.equal(alive, false);
  } finally {
    if (alive)
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
  }
});

for (const action of ['update', 'remove'])
  test(`queued task ${action} rechecks running state before writing`, async (t) => {
    const dir = await mkdtemp(os.tmpdir() + '/nas-task-race-');
    let finish;
    const pending = new Promise((done) => {
      finish = done;
    });
    const engine = await new engineModule.TaskEngine(dir, {
      runner: async () => {
        await pending;
        return { code: 0 };
      },
    }).init();
    t.after(async () => {
      finish();
      await engine.close();
      await rm(dir, { recursive: true, force: true });
    });
    const input = {
      name: 'original',
      type: 'script',
      script: 'echo test',
      schedule: { kind: 'interval', minutes: 5 },
    };
    const task = await engine.create(input);
    const change =
      action === 'update'
        ? engine.update(task.id, { ...input, name: 'changed' })
        : engine.remove(task.id);
    const check = assert.rejects(change, /执行中/);
    const run = engine.run(task.id);
    await check;
    await run;
    assert.equal(engine.find(task.id).name, 'original');
  });

test('queued update cannot recreate a deleted task', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/nas-task-delete-');
  const engine = await new engineModule.TaskEngine(dir, {
    runner: async () => ({ code: 0 }),
  }).init();
  t.after(async () => {
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  });
  const input = {
    name: 'original',
    type: 'script',
    script: 'echo test',
    schedule: { kind: 'interval', minutes: 5 },
  };
  const task = await engine.create(input);
  const removal = engine.remove(task.id);
  const check = assert.rejects(engine.update(task.id, { ...input, name: 'changed' }), /不存在/);
  await removal;
  await check;
  assert.throws(() => engine.find(task.id), /不存在/);
});

test('restart reconciles running records older than the first history page', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/nas-task-recovery-');
  const engine = await new engineModule.TaskEngine(dir, {
    runner: async () => ({ code: 0 }),
  }).init();
  t.after(async () => {
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  });
  const task = await engine.create({
    name: 'recovery',
    type: 'script',
    script: 'echo test',
    schedule: { kind: 'interval', minutes: 5 },
  });
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
  engine.repository.saveRun(run);
  for (let i = 1; i <= 100; i++)
    engine.repository.saveRun({
      ...run,
      id: 'done-' + i,
      status: 'success',
      startedAt: new Date(Date.parse(run.startedAt) + i * 1000).toISOString(),
    });
  await engine.init();
  assert.equal(engine.repository.running().length, 0);
  assert.equal(engine.repository.history().total, 100);
});
