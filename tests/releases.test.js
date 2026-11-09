import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelease, RELEASES_URL } from '../server/updates/releases.js';
const asset = (name) => ({
  name,
  browser_download_url: `${RELEASES_URL}/download/v0.3.5/${name}`,
  size: 100,
});
const release = {
  tag_name: 'v0.3.5',
  body: '更新说明',
  assets: [asset('0.3.5.fpk'), asset('0.3.5-arm64.fpk')],
};
test('release compares numeric versions and selects target architecture', () => {
  const x = parseRelease(release, '0.3.4', 'x64');
  assert.equal(x.hasUpdate, true);
  assert.equal(x.asset.name, '0.3.5.fpk');
  assert.equal(parseRelease(release, '0.3.4', 'arm64').asset.name, '0.3.5-arm64.fpk');
  assert.equal(parseRelease(release, '0.3.5', 'x64').hasUpdate, false);
  assert.equal(parseRelease(release, '0.3.10', 'x64').hasUpdate, false);
  assert.equal(parseRelease(release, '0.3.4', 'riscv64').asset, null);
});
test('release rejects prereleases, ambiguous assets and external download URLs', () => {
  assert.equal(parseRelease({ ...release, prerelease: true }, '0.3.4', 'x64').latest, null);
  assert.equal(
    parseRelease({ ...release, assets: [asset('a-x64.fpk'), asset('b-x64.fpk')] }, '0.3.4', 'x64')
      .asset,
    null,
  );
  assert.equal(
    parseRelease(
      {
        ...release,
        assets: [{ ...asset('x64.fpk'), browser_download_url: 'https://evil.test/a' }],
      },
      '0.3.4',
      'x64',
    ).asset,
    null,
  );
  assert.equal(parseRelease(null, '0.3.4', 'x64').latest, null);
});

test('update service shares concurrent checks, caches results and handles missing releases', async (t) => {
  const { UpdatesService } = await import('../server/app/common/updates.service.js');
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return new Response(JSON.stringify(release), { status: 200 });
  });
  const service = new UpdatesService({ version: '0.3.4' });
  const [a, b] = await Promise.all([service.check(), service.check()]);
  assert.deepEqual(a, b);
  await service.check();
  assert.equal(count, 1);
  globalThis.fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  assert.equal((await new UpdatesService({ version: '0.3.4' }).check()).latest, null);
  globalThis.fetch.mock.mockImplementation(async () => {
    throw new Error('offline');
  });
  await assert.rejects(new UpdatesService({ version: '0.3.4' }).check(), /暂时无法检查更新/);
});

test('withdrawn or changed release is rejected before installation', async () => {
  const { verifyPublishedRelease, ReleaseWithdrawn } =
    await import('../server/updates/releases.js');
  const spec = {
    version: '0.3.9',
    previousVersion: '0.3.6',
    architecture: 'x64',
    asset: {
      url: 'https://github.com/kaf931/fnos-manager/releases/download/v0.3.9/NAS.-0.3.9-x86_64.fpk',
      size: 100,
      sha256: 'a'.repeat(64),
    },
  };
  await assert.rejects(
    verifyPublishedRelease(spec, async () => new Response('', { status: 404 })),
    ReleaseWithdrawn,
  );
  let checked;
  const release = {
    tag_name: 'v0.3.9',
    body: '',
    assets: [
      {
        name: 'NAS.-0.3.9-x86_64.fpk',
        browser_download_url: spec.asset.url,
        size: 100,
        digest: 'sha256:' + spec.asset.sha256,
      },
    ],
  };
  await verifyPublishedRelease(spec, async (url) => {
    checked = url;
    return Response.json(release);
  });
  assert.match(checked, /releases\/tags\/v0.3.9$/);
  await assert.rejects(
    verifyPublishedRelease(spec, async () => Response.json({ ...release, draft: true })),
    ReleaseWithdrawn,
  );
  await assert.rejects(
    verifyPublishedRelease(
      { ...spec, asset: { ...spec.asset, sha256: 'b'.repeat(64) } },
      async () => Response.json(release),
    ),
    ReleaseWithdrawn,
  );
  await assert.rejects(
    verifyPublishedRelease(spec, async () => new Response('', { status: 503 })),
    /暂时无法确认/,
  );
});

test('release notes expose the mirror category without naming its provider', () => {
  const release = parseRelease(
    { tag_name: '0.3.9', body: '切换 gh-proxy.org 加速线路' },
    '0.3.6',
    'x64',
  );
  assert.equal(release.notes, '切换 镜像加速线路');
});
