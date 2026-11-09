import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPackageConfig } from './package-config.js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-runtime-lock-'));
try {
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(createPackageConfig(pkg).runtime));
  execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--include=optional',
      '--os=linux',
      '--cpu=x64',
    ],
    { cwd: dir, stdio: 'inherit' },
  );
  await copyFile(path.join(dir, 'package-lock.json'), 'scripts/runtime-package-lock.json');
} finally {
  await rm(dir, { recursive: true, force: true });
}
