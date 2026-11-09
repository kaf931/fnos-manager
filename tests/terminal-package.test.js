import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPackageConfig } from '../scripts/package-config.js';
test('native release includes SSH runtime dependencies and consistent version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const { runtime, manifest } = createPackageConfig(pkg, 'x64');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(runtime.version, pkg.version);
  assert.equal(runtime.dependencies.ssh2, '1.17.0');
  assert.equal(runtime.dependencies.ws, '8.22.0');
  assert.equal(runtime.dependencies['@nestjs/core'], pkg.dependencies['@nestjs/core']);
  assert.equal(
    runtime.dependencies['@nestjs/platform-express'],
    pkg.dependencies['@nestjs/platform-express'],
  );
  assert.equal(runtime.dependencies['reflect-metadata'], pkg.dependencies['reflect-metadata']);
  assert.equal(runtime.dependencies.typescript, undefined);
  assert.ok(manifest.split('\n').includes('version=' + pkg.version));
  assert.match(manifest, /display_name=NAS 管家\n/);
  assert.match(manifest, /maintainer=kaf\n/);
  assert.match(manifest, /distributor=kaf\n/);
  assert.ok(manifest.split('\n').includes('maintainer_url=https://github.com/kaf931/fnos-manager'));
  assert.ok(
    manifest
      .split('\n')
      .includes('distributor_url=https://club.fnnas.com/home.php?mod=space&uid=91804'),
  );
  for (const feature of ['存储管理', '网络唤醒', 'AI 助手', '独立桌面入口']) {
    assert.ok(
      manifest
        .split('\n')
        .find((line) => line.startsWith('desc='))
        .includes(feature),
    );
  }
  assert.match(manifest, /os_min_version=1.2.0800/);
  assert.match(manifest, /desktop_applaunchname=deskicons.main/);
});

test('ARM package omits minimum OS restriction while x86 retains it', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const arm = createPackageConfig(pkg, 'arm64').manifest;
  assert.match(arm, /^platform=arm$/m);
  assert.doesNotMatch(arm, /^os_min_version=/m);
  assert.match(createPackageConfig(pkg, 'x64').manifest, /^os_min_version=1\.2\.0800$/m);
});
