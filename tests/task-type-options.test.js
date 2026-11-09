import test from 'node:test';
import assert from 'node:assert/strict';
import { taskTypeOptions } from '../.web-test/task-type-options.js';
test('task types requiring official authorization are explained and disabled until connected', () => {
  const types = [
    { id: 'reboot', name: '重启 NAS', group: '系统', support: 'oauth', available: true },
    { id: 'script', name: '脚本', group: '自定义', support: 'script', available: true },
    { id: 'backup', name: '备份', group: '文件', support: 'unavailable', available: false },
  ];
  const options = taskTypeOptions({ types, connection: { connected: false } });
  assert.equal(options[0].disabled, true);
  assert.match(options[0].label, /需官方授权/);
  assert.equal(options[1].disabled, false);
  assert.match(options[2].label, /暂不可用/);
  assert.equal(taskTypeOptions({ types, connection: { connected: true } })[0].disabled, false);
});
