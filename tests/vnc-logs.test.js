import test from 'node:test';
import assert from 'node:assert/strict';
import { VncLogStore, vncNetworkError } from '../server/vnc/logs.js';
test('VNC diagnostics isolate owners, retain closed failures briefly and bound memory', () => {
  let now = 1000;
  const logs = new VncLogStore({ now: () => now, ttlMs: 100, maxSessions: 2, maxEntries: 2 });
  logs.create('a', 'owner');
  logs.append('a', 'network', 'info', '连接开始');
  now += 10;
  logs.append('a', 'network', 'error', '连接被拒绝');
  logs.append('a', 'disconnect', 'info', '连接结束');
  assert.throws(() => logs.read('other', 'a'), /不存在/);
  const items = logs.read('owner', 'a');
  assert.equal(items.length, 2);
  assert.equal(items[0].elapsedMs, 10);
  items.length = 0;
  assert.equal(logs.read('owner', 'a').length, 2);
  logs.close('a');
  assert.equal(logs.read('owner', 'a').length, 2);
  logs.create('b', 'owner');
  logs.close('b');
  logs.create('c', 'owner');
  assert.throws(() => logs.read('owner', 'a'), /不存在/);
  now += 101;
  assert.throws(() => logs.read('owner', 'b'), /不存在/);
  logs.delete('c');
  assert.throws(() => logs.read('owner', 'c'), /不存在/);
});
test('network diagnostic messages classify safe codes without exposing arbitrary errors', () => {
  assert.match(vncNetworkError({ code: 'ECONNREFUSED', message: 'password=secret' }), /拒绝/);
  assert.match(vncNetworkError({ code: 'ENOTFOUND' }), /解析/);
  assert.match(vncNetworkError({ code: 'ETIMEDOUT' }), /超时/);
  assert.match(vncNetworkError({ code: 'ENETUNREACH' }), /网络不可达/);
  assert.doesNotMatch(
    vncNetworkError({ message: 'password=secret ticket=private' }),
    /secret|private/,
  );
});
