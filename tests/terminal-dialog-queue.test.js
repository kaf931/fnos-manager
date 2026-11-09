import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogQueue, sendCommandSafely } from '../.web-test/terminal-dialog-queue.js';
test('dialogs serialize, cancellation settles A and starts B without leaking credentials', async () => {
  const q = createDialogQueue(),
    calls = [];
  let finish;
  const a = q.enqueue(
    'a',
    () =>
      new Promise((r) => {
        calls.push('a');
        finish = r;
      }),
    () => calls.push('cancel-a'),
  );
  const b = q.enqueue('b', () => {
    calls.push('b');
    return 'B';
  });
  await Promise.resolve();
  assert.deepEqual(calls, ['a']);
  q.cancel('a');
  assert.equal(await a, false);
  assert.equal(await b, 'B');
  finish('A');
  assert.deepEqual(calls, ['a', 'cancel-a', 'b']);
});
test('cancel pending callback is never executed', async () => {
  const q = createDialogQueue();
  let finish;
  const a = q.enqueue('a', () => new Promise((r) => (finish = r)));
  const b = q.enqueue('b', () => assert.fail('cancelled'));
  q.cancel('b');
  assert.equal(await b, false);
  finish(true);
  await a;
});
test('commands append one Enter and require multiline confirmation, reject control sequences', async () => {
  let sent = [];
  const options = { connected: () => true, send: (s) => sent.push(s), confirm: async () => false };
  await sendCommandSafely('pwd', options);
  await sendCommandSafely('pwd\rwhoami', options);
  await assert.rejects(sendCommandSafely('bad\x1b', options));
  assert.deepEqual(sent, ['pwd\r']);
  options.confirm = async () => true;
  await sendCommandSafely('a\nb', options);
  assert.deepEqual(sent, ['pwd\r', 'a\nb\r']);
  await sendCommandSafely('pwd\r\n', options);
  assert.equal(sent.at(-1), 'pwd\r');
  options.connected = () => false;
  assert.equal(await sendCommandSafely('pwd', options), false);
});
