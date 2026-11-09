import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask } from '../server/tasks/model.js';
import { describeAction } from '../server/tasks/runner.js';
test('all log modules keeps official -1 and uses CLI equals syntax for negative values', () => {
  const task = validateTask({
    name: '清理全部模块',
    type: 'log-clear',
    acknowledged: true,
    level: -1,
    module: -1,
    schedule: { kind: 'daily', time: '03:00' },
  });
  assert.equal(task.module, -1);
  assert.equal(task.level, -1);
  assert.deepEqual(describeAction(task).args, [
    'logger',
    'clear',
    '--level=-1',
    '--module=-1',
    '--yes',
  ]);
});
test('log filter rejects blank identifiers instead of treating them as system module zero', () => {
  assert.throws(() =>
    validateTask({
      name: '清理',
      type: 'log-clear',
      acknowledged: true,
      level: '',
      module: '',
      schedule: { kind: 'daily', time: '03:00' },
    }),
  );
});
