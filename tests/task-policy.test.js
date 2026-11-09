import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { DatabaseService } from '../server/persistence/database.service.js';
import { TaskEngine } from '../server/tasks/engine.js';
import { validateTask } from '../server/tasks/model.js';
const base = {
  name: 'safe desired state',
  type: 'app',
  target: 'example',
  action: 'start',
  schedule: { kind: 'interval', minutes: 1 },
};
async function fixture(t, runner) {
  const dir = await mkdtemp(os.tmpdir() + '/task-policy-');
  const database = new DatabaseService(dir);
  const engine = await new TaskEngine(dir, { database, runner }).init();
  t.after(async () => {
    await engine.close();
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  return engine;
}
test('repeat policy rejects scripts, restart and invalid retry counts', () => {
  for (const change of [
    { type: 'script', script: 'echo x' },
    { action: 'restart' },
    { type: 'reboot', acknowledged: true },
  ])
    for (const policy of [{ retryCount: 1 }, { missedPolicy: 'once' }])
      assert.throws(() => validateTask({ ...base, ...change, ...policy }), /仅唤醒/);
  for (const count of [-1, 3, 1.5, '1'])
    assert.throws(() => validateTask({ ...base, retryCount: count }));
  assert.equal(validateTask(base).missedPolicy, 'skip');
});

test('task edits and toggles reject stale revisions without replacing newer configuration', async (t) => {
  const engine = await fixture(t, async () => ({ code: 0 }));
  const now = new Date('2026-11-07T00:00:00.000Z');
  const original = await engine.create(base, now);
  const newer = await engine.update(original.id, { ...original, name: 'New name' }, now);
  assert.notEqual(
    newer.updatedAt,
    original.updatedAt,
    'same-millisecond edits still advance the revision',
  );
  await assert.rejects(
    engine.update(original.id, { ...original, enabled: true }),
    (error) => error.status === 409 && /配置已变化/.test(error.message),
  );
  assert.equal(engine.find(original.id).name, 'New name');
  assert.equal(engine.find(original.id).enabled, newer.enabled);
});

test('two concurrent task edits cannot both commit the same revision', async (t) => {
  const engine = await fixture(t, async () => ({ code: 0 }));
  const original = await engine.create(base);
  const results = await Promise.allSettled([
    engine.update(original.id, { ...original, name: 'First' }),
    engine.update(original.id, { ...original, name: 'Second' }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(results[1].reason.status, 409);
  assert.equal(engine.find(original.id).name, 'First');
});
test('retry is bounded and delayed, succeeds once without extra attempts', async (t) => {
  const timer = globalThis.setTimeout;
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    delays.push(ms);
    return timer(fn, ms === 30000 ? 0 : ms, ...args);
  });
  let calls = 0;
  const engine = await fixture(t, async () => ({ code: ++calls === 3 ? 0 : 1 }));
  const task = await engine.create({ ...base, retryCount: 2 });
  await engine.run(task.id);
  await engine.idle();
  assert.equal(calls, 3);
  assert.deepEqual(
    delays.filter((x) => x === 30000),
    [30000, 30000],
  );
  assert.equal(engine.history(task.id)[0].status, 'success');
  assert.match(engine.history(task.id)[0].stderr, /共执行 3 次/);
});
test('timeout never retries even for repeatable task', async (t) => {
  let calls = 0;
  const engine = await fixture(t, async () => {
    calls++;
    return { code: 1, timedOut: true };
  });
  const task = await engine.create({ ...base, retryCount: 2 });
  await engine.run(task.id);
  await engine.idle();
  assert.equal(calls, 1);
  assert.equal(engine.history(task.id)[0].status, 'timeout');
});
test('shutdown interrupts retry wait without executing again', async (t) => {
  let calls = 0;
  const engine = await fixture(t, async () => {
    calls++;
    return { code: 1 };
  });
  const task = await engine.create({ ...base, retryCount: 2 });
  await engine.run(task.id);
  await new Promise((r) => setImmediate(r));
  await engine.close();
  assert.equal(calls, 1);
  assert.equal(engine.history(task.id)[0].status, 'interrupted');
});
test('startup skips missed tasks by default and coalesces opted-in task to one execution', async (t) => {
  let calls = 0;
  const engine = await fixture(t, async () => {
    calls++;
    return { code: 0 };
  });
  const old = new Date(Date.now() - 3600000);
  const skip = await engine.create({ ...base, enabled: true }, old);
  const once = await engine.create({ ...base, enabled: true, missedPolicy: 'once' }, old);
  await engine.init();
  assert.ok(new Date(engine.find(skip.id).nextRunAt) > new Date());
  assert.ok(new Date(engine.find(once.id).nextRunAt) < new Date());
  await engine.tick();
  await engine.idle();
  await engine.tick();
  await engine.idle();
  assert.equal(calls, 1);
  assert.ok(new Date(engine.find(once.id).nextRunAt) > new Date());
});
