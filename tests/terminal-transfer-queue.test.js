import test from 'node:test';
import assert from 'node:assert/strict';
import { TransferService } from '../server/terminal/transfers.js';
import {
  retainUpload,
  mergePendingUploads,
  cancelPendingUpload,
  retryUpload,
  canRetryUpload,
  clearRetainedUploads,
} from '../.web-test/terminal-transfer-retry.js';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const input = {
  owner: 'a',
  sessionId: 's',
  connectionName: 'NAS',
  direction: 'upload',
  path: '/a',
  size: 2,
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};
test('server FIFO starts after predecessor ends, isolates cancel, and queued cancel never starts', async () => {
  const service = new TransferService();
  let aborted = 0;
  const a = service.begin(input, () => {
    aborted++;
  });
  const b = service.begin({ ...input, path: '/b' });
  const c = service.begin({ ...input, path: '/c' });
  const bRejected = assert.rejects(b.ready, /取消/);
  await a.ready;
  assert.deepEqual(
    service.list('a', 's').items.map((x) => x.status),
    ['queued', 'queued', 'running'],
  );
  const [third, second, first] = service.list('a', 's').items;
  assert.throws(() => service.cancel('other', 's', first.id), /不存在/);
  service.cancel('a', 's', second.id);
  await bRejected;
  assert.equal(second.status, 'cancelled');
  service.cancel('a', 's', first.id);
  assert.equal(aborted, 1);
  assert.equal(third.status, 'queued', 'wait for active I/O cleanup before advancing');
  a.finish('cancelled');
  await c.ready;
  assert.equal(third.status, 'running');
  c.finish('completed');
  assert.equal(service.list('a', 's').active, 0);
});
test('closing a session aborts running work, rejects queued work, and never resurrects records', async () => {
  const service = new TransferService();
  let aborted = 0;
  const a = service.begin(input, () => {
    aborted++;
  });
  const b = service.begin(input, () => {
    aborted++;
  });
  const rejected = assert.rejects(b.ready, /会话已结束/);
  service.clearSession('s');
  await rejected;
  assert.equal(aborted, 2);
  a.finish('completed');
  b.finish('failed');
  assert.deepEqual(service.list('a', 's'), { active: 0, items: [] });
});
test('browser queues unsent Files, cancels a pending item, retries from zero, and releases originals', async () => {
  const session = { id: 'browser-fifo', generation: 1, connected: true };
  const first = deferred();
  const calls = [];
  const file = new File(['abc'], 'a.txt');
  const a = retainUpload(session, '/', 'a.txt', file, {}, () => {
    calls.push('a');
    return first.promise;
  });
  const b = retainUpload(session, '/', 'b.txt', file, {}, () => {
    calls.push('b');
    return Promise.resolve();
  });
  const rejected = assert.rejects(b, /取消/);
  await tick();
  assert.deepEqual(calls, ['a']);
  const records = mergePendingUploads(session.id, []);
  assert.equal(records.length, 2);
  const pending = records.find((x) => x.path === '/b.txt');
  assert.equal(pending.status, 'queued');
  assert.equal(cancelPendingUpload(session.id, pending.clientId), true);
  await rejected;
  assert.equal(pending.status, 'cancelled');
  const retry = retryUpload(session.id, pending.clientId);
  await assert.rejects(retryUpload(session.id, pending.clientId), /正在上传或排队/);
  await tick();
  assert.deepEqual(calls, ['a']);
  first.resolve();
  await a;
  await retry;
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(canRetryUpload(session.id, pending.clientId), false);
  assert.deepEqual(mergePendingUploads(session.id, []), []);
  clearRetainedUploads(session.id);
});
test('browser failed retry receives a fresh signal and no stale panel progress callback', async () => {
  const session = { id: 'browser-retry', generation: 1, connected: true };
  const original = new AbortController();
  let attempts = 0;
  const progress = () => {};
  const first = retainUpload(
    session,
    '/tmp',
    'fail.txt',
    new File(['x'], 'fail.txt'),
    { signal: original.signal, onProgress: progress },
    async (options) => {
      attempts++;
      if (attempts === 1) {
        assert.equal(options.onProgress, progress);
        throw Error('network');
      }
      assert.equal(options.signal.aborted, false);
      assert.equal(options.onProgress, undefined);
    },
  );
  await assert.rejects(first, /network/);
  const [record] = mergePendingUploads(session.id, []);
  assert.equal(record.transferred, 0);
  original.abort();
  await retryUpload(session.id, record.clientId);
  assert.equal(attempts, 2);
  clearRetainedUploads(session.id);
});
test('session close cancels browser active and queued uploads and clears retained Files', async () => {
  const session = { id: 'browser-close', generation: 1, connected: true };
  let queuedStarted = false;
  const a = retainUpload(
    session,
    '/',
    'a',
    new File(['a'], 'a'),
    {},
    ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Error('closed')), { once: true }),
      ),
  );
  const b = retainUpload(session, '/', 'b', new File(['b'], 'b'), {}, async () => {
    queuedStarted = true;
  });
  const rejected = Promise.all([assert.rejects(a), assert.rejects(b)]);
  await tick();
  clearRetainedUploads(session.id);
  await rejected;
  assert.equal(queuedStarted, false);
  assert.deepEqual(mergePendingUploads(session.id, []), []);
});

test('HTTP cancel enforces owner/CSRF, prevents queued remote reads, aborts active stream, and allows a fresh retry', async (t) => {
  const { Readable } = await import('node:stream');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { appFixture } = await import('./fixtures/terminal-app.js');
  const { TerminalService } = await import('../server/app/terminal/terminal.service.js');
  const f = await appFixture();
  let sent = false;
  const stream = new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.from('a'));
      }
    },
  });
  t.after(async () => {
    stream.destroy();
    await f.close();
  });
  const reads = [];
  const files = {
    download: async (path) => {
      reads.push(path);
      return reads.length === 1
        ? { name: 'first', size: 10, stream }
        : { name: 'retry', size: 2, stream: Readable.from([Buffer.from('ok')]) };
    },
  };
  f.app.get(TerminalService).service.connectedOwned = (owner, id) => {
    if (owner !== '1000' || id !== 'fixture')
      throw Object.assign(Error('会话不存在'), { status: 404 });
    return { connection: { name: 'Fixture' }, files: () => files };
  };
  const first = await f.call('/sessions/fixture/files/download?path=%2Ffirst');
  const reader = first.body.getReader();
  assert.equal((await reader.read()).value.length, 1);
  const queued = f.call('/sessions/fixture/files/download?path=%2Fsecond');
  let history;
  for (let i = 0; i < 100; i++) {
    history = await (await f.call('/transfers?sessionId=fixture')).json();
    if (history.active === 2) break;
    await delay(10);
  }
  assert.equal(history.active, 2);
  const pending = history.items.find((x) => x.status === 'queued');
  const running = history.items.find((x) => x.status === 'running');
  const cancelPath = (id) => `/sessions/fixture/transfers/${id}/cancel`;
  assert.equal(
    (await f.call(cancelPath(running.id), 'POST', undefined, { 'x-trim-userid': '1001' })).status,
    404,
  );
  assert.equal(
    (await f.call(cancelPath(running.id), 'POST', undefined, { 'x-deskicons-token': 'wrong' }))
      .status,
    403,
  );
  assert.equal((await f.call(cancelPath(pending.id), 'POST')).status, 204);
  assert.equal((await queued).status, 409);
  assert.deepEqual(reads, ['/first']);
  assert.equal((await f.call(cancelPath(running.id), 'POST')).status, 204);
  await assert.rejects(reader.read());
  for (let i = 0; i < 100; i++) {
    history = await (await f.call('/transfers?sessionId=fixture')).json();
    if (!history.active) break;
    await delay(10);
  }
  assert.equal(stream.destroyed, true);
  assert.equal(history.active, 0);
  assert.equal(history.items.filter((x) => x.status === 'cancelled').length, 2);
  const retry = await f.call('/sessions/fixture/files/download?path=%2Ffirst');
  assert.equal(await retry.text(), 'ok');
  assert.deepEqual(reads, ['/first', '/first']);
  history = await (await f.call('/transfers?sessionId=fixture')).json();
  assert.equal(history.items[0].status, 'completed');
  assert.equal(history.items[0].transferred, 2);
});
