import test from 'node:test';
import assert from 'node:assert/strict';
import { createVncOutput } from '../server/vnc/output.js';

function fixture() {
  const events = [],
    failures = [],
    callbacks = [];
  const socket = {
    destroyed: false,
    pause: () => events.push('pause'),
    resume: () => events.push('resume'),
  };
  const ws = {
    readyState: 1,
    bufferedAmount: 10 * 1024 * 1024,
    send: (data, options, callback) => callbacks.push(callback),
  };
  const output = createVncOutput(socket, ws, (reason) => failures.push(reason));
  return { output, socket, ws, events, failures, callbacks };
}
test('slow VNC receivers pause TCP and resume only after WebSocket has drained', () => {
  const f = fixture();
  f.output.send(Buffer.alloc(65536));
  assert.deepEqual(f.events, ['pause']);
  assert.deepEqual(f.failures, []);
  f.callbacks.shift()();
  assert.deepEqual(f.events, ['pause', 'resume']);
  f.output.dispose();
});
test('VNC output has a bounded stall timeout and never resumes disposed connections', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.output.send(Buffer.alloc(1024));
  t.mock.timers.tick(30001);
  assert.deepEqual(f.failures, ['客户端数据传输超时']);
  f.output.dispose();
  f.callbacks.shift()();
  assert.deepEqual(f.events, ['pause']);
});
test('VNC output send errors terminate safely without exposing the raw exception', () => {
  const f = fixture();
  f.output.send(Buffer.alloc(1));
  f.callbacks.shift()(new Error('private target'));
  assert.deepEqual(f.failures, ['WebSocket 数据发送失败']);
  assert.deepEqual(f.events, ['pause']);
  f.output.dispose();
});

test('VNC diagnostics measure relay rates, queued bytes and outstanding send time without changing flow control', () => {
  let now = 1000;
  const f = fixture();
  const output = createVncOutput(
    f.socket,
    f.ws,
    (r) => f.failures.push(r),
    () => now,
  );
  output.send(Buffer.alloc(2048));
  now = 2500;
  const pending = output.sample();
  assert.equal(pending.receivedBytes, 2048);
  assert.equal(pending.sentBytes, 0);
  assert.equal(pending.maxSendMs, 1500);
  assert.equal(pending.intervalMs, 1500);
  assert.equal(pending.bufferedBytes, 10 * 1024 * 1024);
  assert.deepEqual(f.events, ['pause']);
  f.callbacks.shift()();
  now = 3000;
  const drained = output.sample();
  assert.equal(drained.receivedBytes, 0);
  assert.equal(drained.sentBytes, 2048);
  assert.equal(drained.maxSendMs, 1500);
  assert.deepEqual(f.events, ['pause', 'resume']);
  output.dispose();
});
