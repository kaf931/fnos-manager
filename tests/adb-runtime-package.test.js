import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyAdbRuntime } from '../scripts/adb-runtime.js';
test('ADB packaging rejects incomplete, corrupt or wrong-architecture native dependencies', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'adb-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(verifyAdbRuntime(dir, 'x64'));
  await mkdir(path.join(dir, 'bin'));
  const elf = Buffer.alloc(64);
  elf.write('7f454c46', 0, 'hex');
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(62, 18);
  await writeFile(path.join(dir, 'bin/adb.bin'), elf);
  await writeFile(path.join(dir, 'bin/adb'), '#!/bin/sh\n');
  const manifest = {
    arch: 'x64',
    version: '1:34.0.5-12',
    files: {
      'bin/adb.bin': createHash('sha256').update(elf).digest('hex'),
      'bin/adb': createHash('sha256').update('#!/bin/sh\n').digest('hex'),
    },
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  await verifyAdbRuntime(dir, 'x64');
  await assert.rejects(verifyAdbRuntime(dir, 'arm64'));
  await writeFile(path.join(dir, 'bin/adb.bin'), 'corrupt');
  await assert.rejects(verifyAdbRuntime(dir, 'x64'));
});
