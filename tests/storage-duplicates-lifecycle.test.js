import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, open, realpath, lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DuplicateService } from '../server/storage/duplicates.js';

async function within(work, milliseconds = 1500) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('duplicate operation did not settle')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
for (const replaced of ['copy', 'keep']) {
  test(`duplicate worker rejects ${replaced} replaced by a FIFO without blocking`, async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'duplicate-fifo-')));
    let handle, child;
    try {
      await writeFile(dir + '/copy', 'same');
      await writeFile(dir + '/keep', 'same');
      await rm(dir + '/' + replaced);
      assert.equal(spawnSync('mkfifo', [dir + '/' + replaced]).status, 0);
      handle = await open(dir, 'r');
      child = spawn('python3', ['backend/storage/duplicates-worker.py'], {
        stdio: ['pipe', 'pipe', 'pipe', handle.fd],
      });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stdin.end(
        JSON.stringify({
          action: 'delete',
          rootPath: dir,
          items: [{ path: dir + '/copy', keep: dir + '/keep', size: 4 }],
        }),
      );
      await within(once(child, 'close'));
      const result = JSON.parse(output);
      assert.equal(result.results[0].success, false);
      assert.match(result.results[0].error, /普通文件/);
      assert.equal((await lstat(dir + '/' + replaced)).isFIFO(), true);
      assert.equal(
        await readFile(dir + '/' + (replaced === 'copy' ? 'keep' : 'copy'), 'utf8'),
        'same',
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'close');
      }
      await handle?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const reason of ['timeout', 'close']) {
  test(`duplicate ${reason} force-stops a worker that ignores SIGTERM and releases its lock`, async (t) => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'duplicate-stubborn-')));
    const originalPath = process.env.PATH;
    let actions, child, task;
    try {
      await mkdir(dir + '/bin');
      await writeFile(
        dir + '/bin/python3',
        '#!' +
          process.execPath +
          '\n' +
          "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(" +
          JSON.stringify(dir + '/ready') +
          ", 'ready'); setInterval(() => {}, 1000);\n",
        { mode: 0o700 },
      );
      process.env.PATH = dir + '/bin:' + originalPath;
      const job = {
        id: 'scan',
        owner: 'owner',
        path: dir,
        mode: 'duplicates',
        status: 'completed',
        result: { groups: [{ size: 4, paths: [dir + '/keep', dir + '/copy'] }] },
      };
      const storage = {
        jobs: new Map([['scan', job]]),
        get: () => job,
        resolve: async (value) => value,
        persist: async () => {},
      };
      actions = new DuplicateService(storage);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      task = actions.process('owner', 'scan', {
        confirmed: true,
        action: 'delete',
        items: [{ path: dir + '/copy', keep: dir + '/keep' }],
      });
      task.catch(() => {});
      while (!actions.children.size) await delay(10);
      child = [...actions.children][0];
      while (!(await lstat(dir + '/ready').catch(() => null))) await delay(10);
      let closing;
      if (reason === 'timeout') t.mock.timers.tick(120000);
      else closing = actions.close();
      // Permit the worker to roll back before enforcing the shutdown deadline.
      t.mock.timers.tick(4999);
      await delay(30);
      assert.equal(child.signalCode, null);
      t.mock.timers.tick(1);
      t.mock.timers.reset();
      await within(Promise.allSettled([task, ...(closing ? [closing] : [])]));
      assert.equal(child.signalCode, 'SIGKILL');
      assert.equal(storage.recordOperations.size, 0);
      assert.equal(actions.children.size, 0);
    } finally {
      t.mock.timers.reset();
      process.env.PATH = originalPath;
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (task) await Promise.allSettled([task]);
      await actions?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('duplicate shutdown during path resolution does not start deleting files afterward', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'duplicate-closing-')));
  let actions;
  try {
    await writeFile(dir + '/copy', 'same');
    await writeFile(dir + '/keep', 'same');
    let release;
    const resolving = new Promise((resolve) => (release = resolve));
    const job = {
      id: 'scan',
      owner: 'owner',
      path: dir,
      mode: 'duplicates',
      status: 'completed',
      result: { groups: [{ size: 4, paths: [dir + '/keep', dir + '/copy'] }] },
    };
    const storage = {
      jobs: new Map([['scan', job]]),
      get: () => job,
      resolve: () => resolving,
      persist: async () => {},
    };
    actions = new DuplicateService(storage);
    const processing = actions.process('owner', 'scan', {
      confirmed: true,
      action: 'delete',
      items: [{ path: dir + '/copy', keep: dir + '/keep' }],
    });
    const closing = actions.close();
    release(dir);
    await assert.rejects(processing, /服务正在关闭/);
    await closing;
    assert.equal(await readFile(dir + '/copy', 'utf8'), 'same');
    assert.equal(await readFile(dir + '/keep', 'utf8'), 'same');
    assert.equal(storage.recordOperations.size, 0);
  } finally {
    await actions?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
