import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createPackageConfig } from '../scripts/package-config.js';

test('release stop waits for graceful shutdown before removing PID', async () => {
  const source = await readFile('scripts/package.js', 'utf8');
  const script = await readFile('scripts/service-main.sh', 'utf8').catch(
    () => source.match(/const main = `([\s\S]*?)`;/)[1],
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-stop-'));
  const child = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),1200));console.log('ready');setInterval(()=>{},1000)",
  ]);
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    await writeFile(path.join(dir, 'service.pid'), String(child.pid));
    const started = Date.now();
    const stop = spawn('sh', ['-c', script, 'main', 'stop'], {
      env: { ...process.env, TRIM_PKGVAR: dir },
    });
    const [code] = await once(stop, 'exit');
    assert.equal(code, 0);
    assert.ok(Date.now() - started >= 1100, 'stop returned while process was shutting down');
    await assert.rejects(access(path.join(dir, 'service.pid')));
  } finally {
    child.kill('SIGKILL');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime lock matches release dependencies and includes integrity hashes', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('scripts/runtime-package-lock.json', 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies, createPackageConfig(pkg).runtime.dependencies);
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name) assert.match(entry.integrity, /^sha512-/);
  }
});

test('release target rejects unsupported architectures and catches mixed native binaries', async () => {
  const { packageTarget, assertTargetElf } = await import('../scripts/package-target.js');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(createPackageConfig(pkg, 'arm64').manifest, /\nplatform=arm\n/);
  assert.match(createPackageConfig(pkg, 'x64').manifest, /\nplatform=x86\n/);
  assert.throws(() => createPackageConfig(pkg, 'arm'), /仅支持/);
  assert.throws(() => packageTarget('../../x64'), /仅支持/);
  const binary = Buffer.alloc(64);
  binary.write('7f454c46', 0, 'hex');
  binary[4] = 2;
  binary[5] = 1;
  binary.writeUInt16LE(183, 18);
  assert.doesNotThrow(() => assertTargetElf(binary, 'arm64', 'test'));
  assert.throws(() => assertTargetElf(binary, 'x64', 'test'), /架构不匹配/);
  binary[5] = 2;
  assert.throws(() => assertTargetElf(binary, 'arm64', 'test'), /架构不匹配/);
  assert.throws(() => assertTargetElf(Buffer.from('not-ELF'), 'arm64', 'test'), /架构不匹配/);
});
