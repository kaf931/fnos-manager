import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalRetry } from '../.web-test/terminal-retry.js';

test('terminal retry accepts one Enter only after disconnect and ignores hidden views and pasted commands', () => {
  const output = [];
  let calls = 0,
    visible = true;
  const retry = createTerminalRetry({
    write: (text) => output.push(text),
    retry: () => calls++,
    canRetry: () => visible,
  });
  assert.equal(retry.input('\r'), false);
  retry.error('网络连接失败');
  assert.equal(retry.input('\r'), false);
  retry.disconnected();
  retry.disconnected();
  assert.equal(output.filter((text) => text.includes('按回车重试')).length, 1);
  assert.match(output.join(''), /失败\x1b\[0m\x1b\[31m · 按回车重试\x1b\[0m\r\n$/);
  assert.equal(retry.input('ls\r'), false);
  visible = false;
  assert.equal(retry.input('\r'), false);
  visible = true;
  assert.equal(retry.input('\r'), true);
  assert.equal(retry.input('\r'), false);
  assert.equal(calls, 1);
  retry.reset();
  assert.equal(retry.input('\r'), false);
  retry.disconnected();
  assert.equal(retry.input('\r\n'), true);
  assert.equal(calls, 2);
});
test('terminal failures use the red palette, remove control sequences and avoid duplicate messages', () => {
  const output = [];
  const retry = createTerminalRetry({
    write: (text) => output.push(text),
    retry: () => {},
    canRetry: () => true,
  });
  retry.error('拒绝连接\x1b[2J\r\n检查端口');
  retry.error('拒绝连接\x1b[2J\r\n检查端口');
  assert.equal(output.length, 1);
  assert.match(output[0], /^\r\n\x1b\[31m/);
  assert.match(output[0], /\x1b\[0m$/);
  assert.doesNotMatch(output[0], /\x1b\[2J/);
  retry.reset();
  retry.error('拒绝连接');
  assert.equal(output.length, 2);
});
