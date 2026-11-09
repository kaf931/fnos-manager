import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AdbSessions } from '../server/adb/service.js';
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(t, size = 3) {
  const sessions = new AdbSessions(process.cwd(), '/tmp/adb-download-test-unused');
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() {
      return true;
    },
  });
  const session = {
    id: 's',
    ownerUid: 'owner',
    serial: 'test',
    connection: { deviceType: 'usb' },
    children: new Set(),
    disposers: new Set(),
    abort: new AbortController(),
    touched: Date.now(),
  };
  sessions.sessions.set('s', session);
  let spawned;
  const ready = new Promise((resolve) => {
    spawned = resolve;
  });
  sessions.runtime.run = async () => String(size);
  sessions.runtime.spawn = async () => {
    spawned();
    return child;
  };
  const output = new PassThrough();
  output.resume();
  const job = sessions.download('owner', 's', '/sdcard/test.txt', output);
  job.catch(() => {});
  t.after(async () => {
    child.emit('close', 1);
    output.destroy();
    await job.catch(() => {});
    await sessions.close();
  });
  await ready;
  await tick();
  return { child, output, job, session };
}
test('ADB download ends its HTTP sink only after successful device process exit', async (t) => {
  const { child, output, job } = await fixture(t);
  child.stdout.end(Buffer.from('abc'));
  await tick();
  await tick();
  assert.equal(output.writableFinished, false);
  child.emit('close', 0);
  await job;
  assert.equal(output.writableFinished, true);
});
test('ADB process failure after stdout EOF cannot finalize a successful download', async (t) => {
  const { child, output, job } = await fixture(t);
  child.stdout.end(Buffer.from('abc'));
  await tick();
  await tick();
  child.emit('close', 1);
  await assert.rejects(job, /ADB 下载失败/);
  assert.equal(output.writableFinished, false);
});
test('ADB rejects a file truncated during download even when its process exits zero', async (t) => {
  const { child, output, job } = await fixture(t, 5);
  child.stdout.end(Buffer.from('abc'));
  await tick();
  child.emit('close', 0);
  await assert.rejects(job, /文件.*变化|文件.*不完整/);
  assert.equal(output.writableFinished, false);
});
test('disconnecting an HTTP sink while waiting for process exit cancels promptly', async (t) => {
  const { child, output, job } = await fixture(t);
  child.stdout.end(Buffer.from('abc'));
  await tick();
  await tick();
  output.destroy();
  const release = setTimeout(() => child.emit('close', 1), 200);
  try {
    await assert.rejects(job, /取消/);
  } finally {
    clearTimeout(release);
  }
});
