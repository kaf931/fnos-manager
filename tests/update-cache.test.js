import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { UpdateCache } from '../server/updates/cache.js';
const done = '11111111-1111-1111-1111-111111111111';
const active = '22222222-2222-2222-2222-222222222222';
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'update-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'updates');
  await mkdir(folder);
  for (const [id, phase] of [
    [done, 'failed'],
    [active, 'downloading'],
  ]) {
    await mkdir(path.join(folder, id));
    await writeFile(
      path.join(folder, id, 'status.json'),
      JSON.stringify({
        id,
        version: '0.3.4',
        phase,
        pid: 0,
        updatedAt: Date.now(),
        message: '测试',
      }),
    );
    await writeFile(path.join(folder, id, 'update.fpk'), 'cached');
    await writeFile(path.join(folder, id, 'update.log'), 'diagnostic');
  }
  return { folder, root, cache: new UpdateCache(folder) };
}
test('cache includes real bytes and log details, cleans terminal tasks while preserving active tasks', async (t) => {
  const { folder, cache } = await setup(t);
  await writeFile(path.join(folder, 'current.json'), JSON.stringify({ id: done }));
  const rows = await cache.records();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.bytes > 6));
  assert.equal(rows.find((row) => row.id === active).status, 'in-use');
  assert.match((await cache.detail(done)).text, /diagnostic/);
  assert.equal(await cache.clear(), 1);
  await assert.rejects(access(path.join(folder, done)));
  await assert.rejects(access(path.join(folder, 'current.json')));
  await access(path.join(folder, active, 'update.fpk'));
});
test('cache never follows external links or removes unknown tasks', async (t) => {
  const { folder, root, cache } = await setup(t);
  const outside = path.join(root, 'important');
  await mkdir(outside);
  await writeFile(path.join(outside, 'data'), 'keep');
  await symlink(outside, path.join(folder, '33333333-3333-3333-3333-333333333333'));
  await symlink(outside, path.join(folder, done, 'external'));
  await mkdir(path.join(folder, '44444444-4444-4444-4444-444444444444'));
  assert.equal(await cache.clear([done, active, '../important']), 1);
  assert.equal(await readFile(path.join(outside, 'data'), 'utf8'), 'keep');
  assert.equal((await cache.records()).find((row) => row.id.startsWith('4444')).status, 'in-use');
});

test('cache root symlinks are ignored and deleting one task preserves the current pointer to another', async (t) => {
  const { folder, root, cache } = await setup(t);
  await writeFile(path.join(folder, 'current.json'), JSON.stringify({ id: active }));
  await cache.clear([done]);
  assert.equal(JSON.parse(await readFile(path.join(folder, 'current.json'), 'utf8')).id, active);
  const alias = path.join(root, 'alias');
  await symlink(folder, alias);
  assert.deepEqual(await new UpdateCache(alias).records(), []);
  assert.equal(await new UpdateCache(alias).clear(), 0);
});

test('a terminal task remains protected until its worker has exited', async (t) => {
  const { folder, cache } = await setup(t);
  const file = path.join(folder, done, 'status.json');
  const job = JSON.parse(await readFile(file, 'utf8'));
  job.pid = process.pid;
  await writeFile(file, JSON.stringify(job));
  assert.equal((await cache.records()).find((row) => row.id === done).status, 'in-use');
  assert.equal(await cache.clear([done]), 0);
});

test('legacy mirror provider names are not exposed by update cache summaries or logs', async (t) => {
  const { folder, cache } = await setup(t);
  const state = JSON.parse(await readFile(path.join(folder, done, 'status.json'), 'utf8'));
  state.message = '正在下载安装包（gh-proxy.org 加速）';
  await writeFile(path.join(folder, done, 'status.json'), JSON.stringify(state));
  await writeFile(path.join(folder, done, 'update.log'), 'gh-proxy.org 加速线路：连接超时');
  const detail = await cache.detail(done);
  assert.match(detail.record.summary, /镜像加速/);
  assert.match(detail.text, /镜像加速线路/);
  assert.doesNotMatch(JSON.stringify(detail), /gh-proxy|ghproxy/);
});

test('public update messages hide concrete mirror URLs while retaining useful diagnostics', async () => {
  const { publicUpdateText } = await import('../server/updates/routes.js');
  const text = publicUpdateText(
    '请求 https://gh-proxy.org/https://github.com/example/file.fpk 超时；gh-proxy.org 加速线路重试',
  );
  assert.equal(text, '请求 镜像加速 超时；镜像加速线路重试');
});
