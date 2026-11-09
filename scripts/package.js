import {
  mkdir,
  rm,
  cp,
  writeFile,
  chmod,
  readFile,
  access,
  rename,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { packageTarget, assertTargetElf } from './package-target.js';
import { verifyAdbRuntime } from './adb-runtime.js';
import { verifyRdpRuntime } from './rdp-runtime.js';
import { createPackageConfig } from './package-config.js';
import { createLifecycleHook, lifecycleActions } from './lifecycle-hooks.js';
const root = path.resolve('.'),
  arch = process.env.TARGET_ARCH || 'x64',
  target = packageTarget(arch),
  dir = path.join(root, arch === 'x64' ? 'build/deskicons' : 'build/deskicons-arm64');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const { renderIcon } = await import('../server/icons.js');
const { buildFpk } = await import('../server/package.js');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
  config = createPackageConfig(pkg, arch);
await rm(dir, { recursive: true, force: true });
for (const p of ['app/server', 'app/dist', 'app/tools', 'app/ui/images', 'cmd', 'config', 'wizard'])
  await mkdir(path.join(dir, p), { recursive: true });
await cp('server', path.join(dir, 'app/server'), { recursive: true });
await cp('dist', path.join(dir, 'app/dist'), { recursive: true });
const rdpRuntime = path.join(root, 'tools/rdp', arch);
await verifyRdpRuntime(rdpRuntime, arch);
await cp(rdpRuntime, path.join(dir, 'app/tools/rdp'), { recursive: true });
const adbRuntime = path.join(root, 'tools/adb', arch);
await verifyAdbRuntime(adbRuntime, arch);
await cp(adbRuntime, path.join(dir, 'app/tools/adb'), { recursive: true });
await writeFile(path.join(dir, 'app/package.json'), JSON.stringify(config.runtime));
const runtimeLock = JSON.parse(await readFile('scripts/runtime-package-lock.json', 'utf8'));
if (
  JSON.stringify(Object.entries(runtimeLock.packages[''].dependencies).sort()) !==
  JSON.stringify(Object.entries(config.runtime.dependencies).sort())
)
  throw new Error('运行依赖已变更，请先执行 npm run lock:runtime');
runtimeLock.version = pkg.version;
runtimeLock.packages[''].version = pkg.version;
await writeFile(path.join(dir, 'app/package-lock.json'), JSON.stringify(runtimeLock));
execFileSync(
  'npm',
  [
    'ci',
    '--omit=dev',
    '--include=optional',
    '--ignore-scripts',
    '--os=linux',
    `--cpu=${arch}`,
    '--prefix',
    path.join(dir, 'app'),
  ],
  { stdio: 'inherit' },
);
// npm 10 on macOS does not honor cross-platform optional dependency selection.
for (const [name, version] of [
  [`sharp-linux-${arch}`, '0.35.5'],
  [`sharp-libvips-linux-${arch}`, '1.3.4'],
]) {
  const archive = path.join(root, 'build', `${name}.tgz`),
    destination = path.join(dir, 'app/node_modules/@img', name);
  try {
    await access(archive);
  } catch {
    execFileSync(
      'curl',
      [
        '-fL',
        '--retry',
        '2',
        '--max-time',
        '60',
        `https://registry.npmjs.org/@img/${name}/-/${name}-${version}.tgz`,
        '-o',
        archive,
      ],
      { stdio: 'inherit' },
    );
  }
  const integrity = runtimeLock.packages[`node_modules/@img/${name}`]?.integrity;
  const digest =
    'sha512-' +
    createHash('sha512')
      .update(await readFile(archive))
      .digest('base64');
  if (integrity !== digest) throw new Error(`运行依赖归档校验失败: ${name}`);
  await mkdir(destination, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
}
const fnpackCache = path.join(root, 'tools', `fnpack-linux-${arch}`);
try {
  await access(fnpackCache);
} catch {
  execFileSync(
    'curl',
    [
      '-fL',
      '--retry',
      '2',
      '--max-time',
      '60',
      `https://static2.fnnas.com/fnpack/fnpack-${target.fnpackVersion}-linux-${arch === 'arm64' ? 'arm64' : 'amd64'}`,
      '-o',
      fnpackCache,
    ],
    { stdio: 'inherit' },
  );
}
if (
  createHash('sha256')
    .update(await readFile(fnpackCache))
    .digest('hex') !== target.fnpackSha256
)
  throw new Error('目标 fnpack 二进制校验失败');
await cp(fnpackCache, path.join(dir, 'app/tools/fnpack'));
await chmod(path.join(dir, 'app/tools/fnpack'), 0o755);
const cliArchive = await readFile(path.join(root, `tools/fnos-cli-linux-${arch}.gz`));
if (createHash('sha256').update(cliArchive).digest('hex') !== target.cliArchive)
  throw new Error('官方 CLI 归档校验失败');
const cli = gunzipSync(cliArchive);
if (createHash('sha256').update(cli).digest('hex') !== target.cliBinary)
  throw new Error('官方 CLI 二进制校验失败');
assertTargetElf(cli, arch, 'fnos-cli');
assertTargetElf(await readFile(fnpackCache), arch, 'fnpack');
await writeFile(path.join(dir, 'app/tools/fnos-cli'), cli, { mode: 0o755 });
// Keep only target sharp binaries; optional SSH accelerators are not cross-compiled.
const imgDir = path.join(dir, 'app/node_modules/@img');
for (const name of await readdir(imgDir))
  if (
    name.startsWith('sharp-') &&
    ![`sharp-linux-${arch}`, `sharp-libvips-linux-${arch}`].includes(name)
  )
    await rm(path.join(imgDir, name), { recursive: true, force: true });
async function checkNativeFiles(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await checkNativeFiles(file);
    else if (entry.isFile() && /\.(?:node|so)(?:\.\d+)*$/.test(entry.name))
      assertTargetElf(await readFile(file), arch, file);
  }
}
await checkNativeFiles(path.join(dir, 'app/node_modules'));
if (
  createHash('sha256')
    .update(await readFile(path.join(root, 'third-party/scrcpy/scrcpy-server-v3.1')))
    .digest('hex') !== '958f0944a62f23b1f33a16e9eb14844c1a04b882ca175a738c16d23cb22b86c0'
)
  throw new Error('scrcpy server 校验失败');
await cp(path.join(root, 'third-party'), path.join(dir, 'app/third-party'), { recursive: true });
await writeFile(path.join(dir, 'manifest'), config.manifest);
await writeFile(
  path.join(dir, 'config/privilege'),
  JSON.stringify(
    { defaults: { 'run-as': 'root' }, username: 'deskicons', groupname: 'deskicons' },
    null,
    2,
  ),
);
await writeFile(path.join(dir, 'config/resource'), '{}');
await writeFile(
  path.join(dir, 'app/ui/config'),
  JSON.stringify(
    {
      '.url': {
        'deskicons.main': {
          title: 'NAS 管家',
          icon: 'images/icon_{0}.png',
          type: 'iframe',
          protocol: '',
          url: '/app/deskicons/',
          gatewayPrefix: '/app/deskicons',
          gatewaySocket: 'app.sock',
          allUsers: false,
          control: { accessPerm: 'readonly' },
        },
      },
    },
    null,
    2,
  ),
);
await cp(path.join(root, 'scripts/wizard'), path.join(dir, 'wizard'), { recursive: true });
const main = await readFile(path.join(root, 'scripts/service-main.sh'), 'utf8');
await writeFile(path.join(dir, 'cmd/main'), main);
await chmod(path.join(dir, 'cmd/main'), 0o755);
for (const name of Object.keys(lifecycleActions)) {
  await writeFile(path.join(dir, 'cmd', name), createLifecycleHook(name));
  await chmod(path.join(dir, 'cmd', name), 0o755);
}
const image = await readFile(path.join(root, 'web/assets/brand/nas-manager.png'));
for (const size of [64, 256]) {
  const icon = await renderIcon(image, size);
  await writeFile(path.join(dir, size === 64 ? 'ICON.PNG' : 'ICON_256.PNG'), icon);
  await writeFile(path.join(dir, `app/ui/images/icon_${size}.png`), icon);
}
const builtPackage = await buildFpk(dir, path.join(root, 'tools/fnpack'));
const versionedPackage = path.join(dir, `${pkg.version}${arch === 'arm64' ? '-arm64' : ''}.fpk`);
await rename(builtPackage, versionedPackage);
console.log('原生应用包:', versionedPackage);
