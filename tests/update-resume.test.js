import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadPackage, carryDownload } from '../server/updates/download.js';
const body = Buffer.from('0123456789'),
  asset = {
    url: 'https://github.com/kaf931/fnos-manager/releases/download/0.3.5/package.fpk',
    size: 10,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'resume-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'update.fpk');
}
async function partial(file, patch = {}) {
  await writeFile(file, body.subarray(0, 4));
  await writeFile(file + '.resume.json', JSON.stringify({ ...asset, etag: '"stable"', ...patch }));
}
test('retry sends a verified Range and If-Range, carries existing bytes into progress and checks the final hash', async (t) => {
  const file = await fixture(t);
  await partial(file);
  const values = [];
  await downloadPackage(
    asset,
    file,
    async (n) => values.push(n),
    async (_, options) => {
      assert.equal(options.headers.Range, 'bytes=4-');
      assert.equal(options.headers['If-Range'], '"stable"');
      return new Response(body.subarray(4), {
        status: 206,
        headers: { 'Content-Range': 'bytes 4-9/10', 'Content-Length': '6', ETag: '"stable"' },
      });
    },
  );
  assert.deepEqual(await readFile(file), body);
  assert.equal(values[0], 4);
  assert.equal(values.at(-1), 10);
});
test('unsupported Range restarts instead of appending and changed validators trigger a fresh request', async (t) => {
  const file = await fixture(t);
  await partial(file);
  await downloadPackage(
    asset,
    file,
    async () => {},
    async () => new Response(body),
  );
  assert.deepEqual(await readFile(file), body);
  await partial(file);
  let calls = 0;
  await downloadPackage(
    asset,
    file,
    async () => {},
    async (_, options) => {
      calls++;
      if (calls === 1)
        return new Response(body.subarray(4), {
          status: 206,
          headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"changed"' },
        });
      assert.equal(options.headers.Range, undefined);
      return new Response(body);
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(await readFile(file), body);
});
test('invalid Content-Range cannot corrupt the partial file; changed asset metadata restarts', async (t) => {
  const file = await fixture(t);
  await partial(file);
  await assert.rejects(
    downloadPackage(
      asset,
      file,
      async () => {},
      async () =>
        new Response(body.subarray(4), {
          status: 206,
          headers: { 'Content-Range': 'bytes 3-8/10' },
        }),
    ),
    /续传范围/,
  );
  assert.equal((await stat(file)).size, 4);
  await partial(file, { sha256: 'a'.repeat(64) });
  await downloadPackage(
    asset,
    file,
    async () => {},
    async (_, options) => {
      assert.equal(options.headers.Range, undefined);
      return new Response(body);
    },
  );
  assert.deepEqual(await readFile(file), body);
});
test('network interruption preserves a partial that can move into a fresh retry task', async (t) => {
  const file = await fixture(t);
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulls++ === 0) controller.enqueue(body.subarray(0, 4));
      else controller.error(new Error('offline'));
    },
  });
  await assert.rejects(
    downloadPackage(
      asset,
      file,
      async () => {},
      async () => new Response(stream, { headers: { ETag: '"stable"' } }),
    ),
    /offline/,
  );
  assert.equal((await stat(file)).size, 4);
  const next = path.join(path.dirname(file), 'next', 'update.fpk');
  await mkdir(path.dirname(next));
  assert.equal(await carryDownload(file, next, asset), 4);
  await downloadPackage(
    asset,
    next,
    async () => {},
    async (_, options) => {
      assert.equal(options.headers.Range, 'bytes=4-');
      return new Response(body.subarray(4), {
        status: 206,
        headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"stable"' },
      });
    },
  );
  assert.deepEqual(await readFile(next), body);
});
test('fully downloaded valid file is reused without network, checksum failure is discarded', async (t) => {
  const file = await fixture(t);
  await writeFile(file, body);
  await writeFile(file + '.resume.json', JSON.stringify(asset));
  await downloadPackage(
    asset,
    file,
    async () => {},
    async () => {
      throw new Error('must not fetch');
    },
  );
  await partial(file);
  await assert.rejects(
    downloadPackage(
      asset,
      file,
      async () => {},
      async () =>
        new Response(Buffer.from('xxxxxx'), {
          status: 206,
          headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"stable"' },
        }),
    ),
    /SHA-256/,
  );
  await assert.rejects(stat(file), { code: 'ENOENT' });
});
test('unsatisfiable Range safely falls back and metadata of another release is not carried', async (t) => {
  const file = await fixture(t);
  await partial(file);
  let calls = 0;
  await downloadPackage(
    asset,
    file,
    async () => {},
    async () => (++calls === 1 ? new Response(null, { status: 416 }) : new Response(body)),
  );
  assert.equal(calls, 2);
  await partial(file);
  assert.equal(
    await carryDownload(file, path.join(path.dirname(file), 'other'), {
      ...asset,
      url: asset.url + '?other',
    }),
    0,
  );
});

test('automatic retry resumes the partial after a connection timeout', async (t) => {
  const { downloadWithRetry } = await import('../server/updates/download.js');
  const file = await fixture(t);
  await partial(file);
  let calls = 0;
  const retries = [],
    delays = [];
  await downloadWithRetry(
    asset,
    file,
    async () => {},
    async (n, text) => retries.push([n, text]),
    async (_, options) => {
      assert.equal(options.headers.Range, 'bytes=4-');
      if (++calls === 1)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
        });
      return new Response(body.subarray(4), {
        status: 206,
        headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"stable"' },
      });
    },
    async (ms) => delays.push(ms),
  );
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
  assert.match(retries[0][1], /连接超时/);
  assert.deepEqual(delays, [2000]);
  assert.deepEqual(await readFile(file), body);
});

test('automatic retry is bounded and does not retry hash failures', async (t) => {
  const { downloadWithRetry } = await import('../server/updates/download.js');
  const file = await fixture(t);
  let calls = 0;
  await assert.rejects(
    downloadWithRetry(
      asset,
      file,
      async () => {},
      async () => {},
      async () => {
        calls++;
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      },
      async () => {},
    ),
    /自动重试.*5.*超时/,
  );
  assert.equal(calls, 6);
  calls = 0;
  await assert.rejects(
    downloadWithRetry(
      asset,
      file,
      async () => {},
      async () => {},
      async () => {
        calls++;
        return new Response('xxxxxxxxxx');
      },
      async () => {},
    ),
    /SHA-256/,
  );
  assert.equal(calls, 1);
});

test('automatic retry handles temporary HTTP failures but not permission errors', async (t) => {
  const { downloadWithRetry } = await import('../server/updates/download.js');
  const file = await fixture(t);
  let calls = 0;
  await downloadWithRetry(
    asset,
    file,
    async () => {},
    async () => {},
    async () => (++calls === 1 ? new Response('', { status: 503 }) : new Response(body)),
    async () => {},
  );
  assert.equal(calls, 2);
  await rm(file);
  await assert.rejects(
    downloadWithRetry(
      asset,
      file,
      async () => {},
      async () => {},
      async () => new Response('', { status: 403 }),
      async () => {},
    ),
    /403/,
  );
});

test('automatic failover uses only the fixed mirror and preserves the original resume identity', async (t) => {
  const { downloadWithRetry } = await import('../server/updates/download.js');
  const file = await fixture(t);
  await partial(file);
  const urls = [],
    lines = [],
    retries = [];
  await downloadWithRetry(
    asset,
    file,
    async (_, line) => lines.push(line),
    async (_, message) => retries.push(message),
    async (url, options) => {
      urls.push(String(url));
      assert.equal(options.headers.Range, 'bytes=4-');
      if (urls.length === 1) throw new TypeError('fetch failed');
      return new Response(body.subarray(4), {
        status: 206,
        headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"stable"' },
      });
    },
    async () => {},
  );
  assert.deepEqual(urls, [asset.url, 'https://gh-proxy.org/' + asset.url]);
  assert.match(retries[0], /加速线路/);
  assert.doesNotMatch([...lines, ...retries].join(' '), /gh-proxy|ghproxy/);
  assert.ok(lines.includes('镜像加速'));
  assert.equal(JSON.parse(await readFile(file + '.resume.json')).url, asset.url);
  assert.deepEqual(await readFile(file), body);
});

test('mirror cannot redirect to an unrelated host and corrupted mirror bytes are rejected', async (t) => {
  const { downloadWithRetry } = await import('../server/updates/download.js');
  const file = await fixture(t);
  let calls = 0;
  await assert.rejects(
    downloadWithRetry(
      asset,
      file,
      async () => {},
      async () => {},
      async () => {
        if (++calls === 1) throw new TypeError('fetch failed');
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://untrusted.example/package.fpk' },
        });
      },
      async () => {},
    ),
    /重定向地址无效/,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    downloadWithRetry(
      asset,
      file,
      async () => {},
      async () => {},
      async () => {
        if (++calls === 1) throw new TypeError('fetch failed');
        return new Response('xxxxxxxxxx');
      },
      async () => {},
    ),
    /SHA-256/,
  );
  assert.equal(calls, 2);
  await assert.rejects(stat(file));
});

test('mirror preference starts at the fixed mirror and resumes through direct failover', async (t) => {
  const { downloadWithRetry } = await import('../server/updates/download.js');
  const file = await fixture(t);
  await partial(file);
  const urls = [];
  await downloadWithRetry(
    asset,
    file,
    async () => {},
    async () => {},
    async (url, options) => {
      urls.push(String(url));
      assert.equal(options.headers.Range, 'bytes=4-');
      if (urls.length === 1) throw new TypeError('fetch failed');
      return new Response(body.subarray(4), {
        status: 206,
        headers: { 'Content-Range': 'bytes 4-9/10', ETag: '"stable"' },
      });
    },
    async () => {},
    'mirror',
  );
  assert.deepEqual(urls, ['https://gh-proxy.org/' + asset.url, asset.url]);
  assert.deepEqual(await readFile(file), body);
});
