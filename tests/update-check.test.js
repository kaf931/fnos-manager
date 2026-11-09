import test from 'node:test';
import assert from 'node:assert/strict';
import { startUpdateChecks } from '../.web-test/update-check.js';
test('background update check is delayed, repeats quietly and stops delivery after disposal', async () => {
  const timeouts = [],
    intervals = [],
    cleared = [],
    received = [];
  const clock = {
    setTimeout: (f, ms) => {
      timeouts.push({ f, ms });
      return 1;
    },
    setInterval: (f, ms) => {
      intervals.push({ f, ms });
      return 2;
    },
    clearTimeout: (id) => cleared.push(id),
    clearInterval: (id) => cleared.push(id),
  };
  let count = 0;
  const stop = startUpdateChecks(
    async () => {
      count++;
      if (count === 2) throw new Error('offline');
      return { hasUpdate: true, latest: '0.3.5' };
    },
    (x) => received.push(x),
    clock,
  );
  assert.equal(count, 0);
  assert.equal(timeouts[0].ms, 4000);
  assert.equal(intervals[0].ms, 21600000);
  timeouts[0].f();
  await new Promise((r) => setImmediate(r));
  assert.equal(received.length, 1);
  intervals[0].f();
  await new Promise((r) => setImmediate(r));
  assert.equal(received.length, 1);
  stop();
  assert.deepEqual(cleared, [1, 2]);
});
