// Linux acceptance against the packaged cancellation implementation, with only disposable processes/files.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { cancelUpdate } = await import(pathToFileURL(path.join(root, 'server/updates/cancel.js')));
const { writeJob } = await import(pathToFileURL(path.join(root, 'server/updates/job.js')));
const dir = await mkdtemp(path.join(os.tmpdir(), 'update-cancel-native-'));
const jobDir = path.join(dir, 'updates', 'job');
await mkdir(path.join(jobDir, 'helper'), { recursive: true });
const script = path.join(jobDir, 'helper/worker.js'),
  spec = path.join(jobDir, 'spec.json');
await writeFile(
  script,
  "const fs=require('node:fs'),path=require('node:path');const file=path.join(__dirname,'../update.fpk');fs.writeFileSync(file,'partial');setInterval(()=>fs.appendFileSync(file,'x'),25);",
);
await writeFile(spec, '{}');
let child;
try {
  child = spawn(process.execPath, [script, spec], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  await writeJob(path.join(jobDir, 'status.json'), {
    id: 'job',
    pid: child.pid,
    phase: 'downloading',
    version: 'test',
    received: 7,
    total: 100,
    message: '',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await stat(path.join(jobDir, 'update.fpk'));
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const result = await cancelUpdate(dir, jobDir);
  assert.equal(result.phase, 'cancelled');
  const kept = await readFile(path.join(jobDir, 'update.fpk'));
  assert.ok(kept.length >= 7);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await readFile(path.join(jobDir, 'update.fpk')), kept);
  await assert.rejects(readFile(`/proc/${child.pid}/cmdline`));
  console.log(
    'Native cancellation: exact detached worker stopped; cache retained; app runtime untouched',
  );
} finally {
  if (child)
    try {
      process.kill(-child.pid, 'SIGTERM');
      process.kill(-child.pid, 'SIGCONT');
    } catch {}
  await rm(dir, { recursive: true, force: true });
}
