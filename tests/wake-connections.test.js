import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeConnectionOptions, wakeConnectionStatus } from '../.web-test/wake-connections.js';
const rows = [
  {
    id: 'local',
    name: 'NAS',
    kind: 'local',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    hasCredentials: true,
  },
  {
    id: 'pending',
    name: '电脑',
    kind: 'remote',
    host: '192.168.1.20',
    port: 22,
    username: 'user',
    hasCredentials: false,
  },
  {
    id: 'ready',
    name: '服务器',
    kind: 'remote',
    host: '192.168.1.21',
    port: 22,
    username: 'root',
    hasCredentials: true,
  },
];
test('wake SSH options show saved connections including pending credentials, with local explicitly disabled', () => {
  const options = wakeConnectionOptions(rows);
  assert.equal(options.length, 3);
  assert.equal(options[0].disabled, true);
  assert.match(options[0].label, /本机/);
  assert.equal(options[1].disabled, true);
  assert.match(options[1].label, /待配置认证/);
  assert.match(options[2].label, /服务器/);
});
test('wake SSH linkage only explains missing connection or authentication setup', () => {
  assert.match(wakeConnectionStatus([rows[0]], ''), /远程 SSH 连接/);
  assert.match(wakeConnectionStatus(rows, 'pending'), /保存认证信息/);
  assert.equal(wakeConnectionStatus(rows, 'ready'), '');
  assert.equal(wakeConnectionStatus(rows, ''), '');
});
