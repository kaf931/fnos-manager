import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectoryLoader } from '../.web-test/terminal-directory-loader.js';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test('duplicate clicks share one request; queued navigation cannot overlap or publish stale results', async () => {
  const a = deferred(),
    b = deferred(),
    started = [],
    published = [];
  let active = 0,
    max = 0;
  const load = createDirectoryLoader({
    request: async (job) => {
      started.push(job.path);
      active++;
      max = Math.max(active, max);
      const result = await (job.path === '/a' ? a.promise : b.promise);
      active--;
      return result;
    },
    onSuccess: (value, job) => published.push([job.path, value]),
  });
  const first = load.load({ key: 'session:/a', path: '/a' });
  assert.equal(load.load({ key: 'session:/a', path: '/a' }), first);
  await new Promise((r) => setImmediate(r));
  const second = load.load({ key: 'session:/b', path: '/b' });
  assert.deepEqual(started, ['/a']);
  a.resolve('old');
  await first;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ['/a', '/b']);
  b.resolve('new');
  await second;
  assert.deepEqual(published, [['/b', 'new']]);
  assert.equal(max, 1);
});
test('failure releases loading and retry succeeds; invalidated queues cannot update next session', async () => {
  let calls = 0;
  const states = [];
  const load = createDirectoryLoader({
    request: async () => {
      if (++calls === 1) throw Error('failed');
      return 'ok';
    },
    onError: (e) => states.push(e.message),
    onSuccess: (v) => states.push(v),
    onFinish: () => states.push('idle'),
  });
  await load.load({ key: 'a' });
  await load.load({ key: 'a' });
  assert.deepEqual(states, ['failed', 'idle', 'ok', 'idle']);
  const wait = deferred();
  const other = createDirectoryLoader({
    request: () => wait.promise,
    onSuccess: (v) => states.push(v),
  });
  const job = other.load({ key: 'old' });
  await new Promise((r) => setImmediate(r));
  other.invalidate();
  wait.resolve('stale');
  await job;
  assert.ok(!states.includes('stale'));
});
test('new session can load immediately while invalidated old request is still pending', async () => {
  const old = deferred(),
    started = [],
    published = [];
  const loader = createDirectoryLoader({
    request: (job) => {
      started.push(job.key);
      return job.key === 'old' ? old.promise : Promise.resolve('new data');
    },
    onSuccess: (value) => published.push(value),
  });
  const first = loader.load({ key: 'old' });
  await new Promise((r) => setImmediate(r));
  loader.invalidate();
  await loader.load({ key: 'new' });
  assert.deepEqual(started, ['old', 'new']);
  assert.deepEqual(published, ['new data']);
  old.resolve('old data');
  await first;
  assert.deepEqual(published, ['new data']);
});
test('mutation refresh always performs a fresh read after the in-flight directory scan', async () => {
  const first = deferred(),
    started = [],
    published = [];
  const loader = createDirectoryLoader({
    request: (job) => {
      started.push(job);
      return started.length === 1 ? first.promise : Promise.resolve('after mutation');
    },
    onSuccess: (value) => published.push(value),
  });
  const old = loader.load({ key: 'same' });
  await new Promise((r) => setImmediate(r));
  const refresh = loader.load({ key: 'same', fresh: true });
  assert.notEqual(refresh, old);
  first.resolve('before mutation');
  await refresh;
  assert.equal(started.length, 2);
  assert.deepEqual(published, ['after mutation']);
});
