import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { attachAdbScreencast } from '../server/adb/screencast.js';
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  closeCount = 0;
  send(message) {
    this.messages.push(JSON.parse(message));
  }
  close() {
    this.readyState = 3;
    this.closeCount++;
    this.emit('close');
  }
}
const options = {
  serial: 'test',
  serverPort: 1,
  serverPath: '/nonexistent/deskicons-screen-test.jar',
};
test('missing packaged server reports explicit failure and disposes once', async () => {
  const socket = new Socket();
  let disposed = 0;
  const close = attachAdbScreencast(socket, {
    ...options,
    onClose() {
      disposed++;
    },
  });
  await delay(30);
  assert.match(socket.messages[0].message, /缺少 scrcpy 3.1 服务文件/);
  assert.equal(socket.closeCount, 1);
  assert.equal(disposed, 1);
  await close();
  assert.equal(disposed, 1);
});
test('early closure aborts startup and suppresses late errors', async () => {
  const socket = new Socket();
  let disposed = 0;
  const close = attachAdbScreencast(socket, {
    ...options,
    onClose() {
      disposed++;
    },
  });
  socket.emit('close');
  await delay(30);
  assert.equal(disposed, 1);
  assert.equal(socket.messages.length, 0);
  await close();
});
test('binary control and large input are rejected and never reach ADB', async () => {
  for (const [raw, binary] of [
    [Buffer.alloc(1), true],
    [Buffer.alloc(9000), false],
  ]) {
    const socket = new Socket();
    attachAdbScreencast(socket, options);
    socket.emit('message', raw, binary);
    await delay(10);
    assert.match(socket.messages[0].message, /格式错误/);
    assert.equal(socket.closeCount, 1);
  }
});
