import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readJob, writeJob } from '../server/updates/job.js';

test('cancel freezes the exact update process before checking the installation boundary and retains cached bytes', async (t) => {
  const { cancelUpdate } = await import('../server/updates/cancel.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cancel-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const jobDir = path.join(dir, 'updates', 'job');
  await mkdir(jobDir, { recursive: true });
  const file = path.join(jobDir, 'status.json');
  const job = {
    id: 'job',
    pid: 12345,
    phase: 'downloading',
    version: '0.3.9',
    received: 7,
    total: 100,
    message: '下载中',
  };
  await writeJob(file, job);
  await writeFile(path.join(jobDir, 'update.fpk'), 'partial');
  const signals = [];
  let alive = true;
  const control = {
    command: async () =>
      alive
        ? ['/usr/bin/node', path.join(jobDir, 'helper/worker.js'), path.join(jobDir, 'spec.json')]
        : [],
    signal: (pid, sig) => {
      signals.push([pid, sig]);
      if (sig === 'SIGTERM') alive = false;
    },
    pause: async () => {},
  };
  const cancelled = await cancelUpdate(dir, jobDir, control);
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal((await readJob(file)).phase, 'cancelled');
  assert.equal(await readFile(path.join(jobDir, 'update.fpk'), 'utf8'), 'partial');
  assert.deepEqual(signals, [
    [-12345, 'SIGSTOP'],
    [-12345, 'SIGTERM'],
    [-12345, 'SIGCONT'],
  ]);
});

test('cancel refuses unrelated processes and resumes an updater that crossed into installation', async (t) => {
  const { cancelUpdate } = await import('../server/updates/cancel.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cancel-boundary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const jobDir = path.join(dir, 'updates', 'job');
  await mkdir(jobDir, { recursive: true });
  const file = path.join(jobDir, 'status.json');
  const job = {
    id: 'job',
    pid: 12345,
    phase: 'downloading',
    version: '0.3.9',
    received: 0,
    total: 100,
    message: '下载中',
  };
  await writeJob(file, job);
  const signals = [];
  await assert.rejects(
    cancelUpdate(dir, jobDir, {
      command: async () => ['other'],
      signal: (_, s) => signals.push(s),
      pause: async () => {},
    }),
    /进程身份/,
  );
  assert.deepEqual(signals, []);
  let reads = 0;
  await assert.rejects(
    cancelUpdate(dir, jobDir, {
      command: async () => {
        if (++reads === 2) await writeFile(path.join(dir, 'updates/installing'), 'job');
        return [
          '/usr/bin/node',
          path.join(jobDir, 'helper/worker.js'),
          path.join(jobDir, 'spec.json'),
        ];
      },
      signal: (_, s) => signals.push(s),
      pause: async () => {},
    }),
    /安装阶段/,
  );
  assert.deepEqual(signals, ['SIGSTOP', 'SIGCONT']);
  assert.equal((await readJob(file)).phase, 'downloading');
});
