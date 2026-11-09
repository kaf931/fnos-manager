import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWakeMonitor,
  wakePresenceLabel,
  wakePresenceTitle,
} from '../.web-test/wake-monitor.js';
const tick = () => new Promise((r) => setImmediate(r));
test('presence labels distinguish no reply, stale evidence and active checks', () => {
  const now = Date.now();
  const row = {
    presence: { state: 'online', reason: 'reply', checkedAt: new Date(now).toISOString() },
  };
  assert.equal(wakePresenceLabel(row, now), '在线');
  assert.equal(wakePresenceLabel(row, now + 120001), '未知');
  assert.equal(wakePresenceLabel({ ...row, checking: true }, now), '检测中…');
  assert.equal(
    wakePresenceLabel({ presence: { ...row.presence, state: 'offline', reason: 'no_reply' } }, now),
    '未响应',
  );
  assert.match(
    wakePresenceTitle({ presence: { ...row.presence, state: 'offline', reason: 'no_reply' } }, now),
    /不代表.*关机/,
  );
});
test('monitor bounds check batches, suppresses duplicate refresh and stops hidden polling', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: String(i), checking: true }));
  const calls = [],
    published = [],
    timers = new Map();
  let next = 0;
  const monitor = createWakeMonitor({
    api: async (route, method, body) => {
      calls.push({ route, method, body });
      return rows;
    },
    onRows: (r) => published.push(r),
    onError: (e) => {
      throw e;
    },
    onBusy() {},
    schedule: (fn) => {
      timers.set(++next, fn);
      return next;
    },
    cancel: (id) => timers.delete(id),
  });
  monitor.setActive(true);
  await Promise.all([monitor.refresh(true), monitor.refresh(true)]);
  assert.deepEqual(
    calls.filter((c) => c.method === 'POST').map((c) => c.body.ids.length),
    [50, 1],
  );
  assert.equal(timers.size, 1);
  monitor.setActive(false);
  assert.equal(timers.size, 0);
  const count = calls.length;
  await tick();
  assert.equal(calls.length, count);
  assert.ok(published.length);
  monitor.dispose();
});
test('late hidden response cannot overwrite a newer visible result; errors release busy', async () => {
  let resolve;
  let defer = true;
  let fail = false;
  const published = [],
    busy = [],
    errors = [];
  const monitor = createWakeMonitor({
    api: async () => {
      if (fail) throw Error('offline');
      if (defer) return new Promise((r) => (resolve = r));
      return [{ id: 'new' }];
    },
    onRows: (r) => published.push(r),
    onBusy: (b) => busy.push(b),
    onError: (e) => errors.push(e),
  });
  monitor.setActive(true);
  const old = monitor.refresh();
  await tick();
  monitor.setActive(false);
  defer = false;
  monitor.setActive(true);
  await monitor.refresh();
  resolve([{ id: 'old' }]);
  await old;
  assert.equal(published.at(-1)[0].id, 'new');
  fail = true;
  await monitor.refresh(true);
  assert.equal(errors.length, 1);
  assert.equal(busy.at(-1), false);
  monitor.dispose();
});

test('mutation reload replaces in-flight snapshot without stale overwrite', async () => {
  let resolve;
  let calls = 0;
  const published = [];
  const monitor = createWakeMonitor({
    api: async () => (++calls === 1 ? new Promise((r) => (resolve = r)) : [{ id: 'saved' }]),
    onRows: (r) => published.push(r),
    onBusy() {},
    onError: (e) => {
      throw e;
    },
  });
  monitor.setActive(true);
  const first = monitor.refresh();
  await tick();
  await monitor.reload();
  resolve([{ id: 'old' }]);
  await first;
  assert.equal(published.at(-1)[0].id, 'saved');
  monitor.dispose();
});

test('manual refresh during a read-only poll still probes after the read completes', async () => {
  let release;
  const calls = [];
  const monitor = createWakeMonitor({
    api: async (route, method) => {
      calls.push({ route, method });
      if (calls.length === 1) return new Promise((r) => (release = r));
      return [{ id: 'one' }];
    },
    onRows() {},
    onBusy() {},
    onError(e) {
      throw e;
    },
  });
  monitor.setActive(true);
  const poll = monitor.refresh();
  await tick();
  const manual = monitor.refresh(true);
  release([{ id: 'one' }]);
  await Promise.all([poll, manual]);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  monitor.dispose();
});

test('checking another device during an in-flight check does not silently skip its probe', async () => {
  let release;
  const requests = [];
  const monitor = createWakeMonitor({
    api: async (route, method, body) => {
      if (method === 'POST') {
        requests.push(body.ids);
        if (requests.length === 1)
          await new Promise((r) => {
            release = r;
          });
      }
      return [{ id: 'one' }, { id: 'two' }];
    },
    onRows() {},
    onBusy() {},
    onError(e) {
      throw e;
    },
  });
  monitor.setActive(true);
  const first = monitor.refresh(true, ['one']);
  await tick();
  const second = monitor.refresh(true, ['two']);
  release();
  try {
    await Promise.all([first, second]);
    assert.deepEqual(requests, [['one'], ['two']]);
  } finally {
    monitor.dispose();
  }
});
