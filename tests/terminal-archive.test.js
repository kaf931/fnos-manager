import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { archiveCommand } from '../server/terminal/archive.js';
const exec = promisify(execFile);
async function run(request) {
  const { stdout } = await exec('/bin/sh', ['-c', archiveCommand(request)]);
  const result = JSON.parse(stdout);
  if (result.error) throw Error(result.error);
  return result;
}
for (const format of ['zip', 'tar.gz'])
  test(
    'archive roundtrip preserves unicode nested files, empty dirs and refuses overwrite: ' + format,
    async (t) => {
      const dir = await mkdtemp(os.tmpdir() + '/archive-');
      t.after(() => rm(dir, { recursive: true, force: true }));
      await mkdir(dir + '/项目/空目录', { recursive: true });
      await writeFile(dir + '/项目/中文.txt', 'archive bytes');
      await run({
        action: 'compress',
        path: dir,
        name: '项目',
        outputName: 'backup.' + format,
        format,
      });
      await run({ action: 'extract', path: dir, name: 'backup.' + format, outputName: '解压结果' });
      assert.equal(await readFile(dir + '/解压结果/项目/中文.txt', 'utf8'), 'archive bytes');
      await access(dir + '/解压结果/项目/空目录');
      await assert.rejects(
        run({ action: 'extract', path: dir, name: 'backup.' + format, outputName: '解压结果' }),
      );
      assert.equal(await readFile(dir + '/解压结果/项目/中文.txt', 'utf8'), 'archive bytes');
    },
  );
test('shell-looking file names remain literal and archive traversal/links are rejected', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/archive-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const name = "literal ' $(touch SHOULD_NOT_EXIST).txt";
  await writeFile(dir + '/' + name, 'safe');
  await run({ action: 'compress', path: dir, name, outputName: 'safe.zip', format: 'zip' });
  await run({ action: 'extract', path: dir, name: 'safe.zip', outputName: 'out' });
  assert.equal(await readFile(dir + '/out/' + name, 'utf8'), 'safe');
  await exec('python3', [
    '-c',
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('../escape','bad');z.close()",
    dir + '/bad.zip',
  ]);
  await assert.rejects(
    run({ action: 'extract', path: dir, name: 'bad.zip', outputName: 'bad-out' }),
  );
  await assert.rejects(access(dir + '/bad-out'));
});
test('extraction rejects link members and declared expansion limits without leaving output', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/archive-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await exec('python3', [
    '-c',
    "import tarfile,sys; a=tarfile.open(sys.argv[1],'w');m=tarfile.TarInfo('escape');m.type=tarfile.SYMTYPE;m.linkname='/tmp';a.addfile(m);a.close()",
    dir + '/link.tar',
  ]);
  await assert.rejects(run({ action: 'extract', path: dir, name: 'link.tar', outputName: 'out' }));
  await assert.rejects(access(dir + '/out'));
  await exec('python3', [
    '-c',
    "import tarfile,sys; a=tarfile.open(sys.argv[1],'w');m=tarfile.TarInfo('large');m.size=2*1024*1024*1024;a.addfile(m);a.close()",
    dir + '/big.tar',
  ]);
  await assert.rejects(
    run({ action: 'extract', path: dir, name: 'big.tar', outputName: 'big-out' }),
  );
  await assert.rejects(access(dir + '/big-out'));
});
test('compression holds directory descriptors when a scanned ancestor is replaced by a link', async (t) => {
  const dir = await mkdtemp(os.tmpdir() + '/archive-race-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(dir + '/tree/sub', { recursive: true });
  await mkdir(dir + '/outside');
  await writeFile(dir + '/tree/sub/inside.txt', 'inside');
  await writeFile(dir + '/outside/inside.txt', 'OUTSIDE');
  const worker = new URL('../server/terminal/archive-worker.py', import.meta.url).pathname;
  const request = Buffer.from(
    JSON.stringify({
      action: 'compress',
      path: dir,
      name: 'tree',
      outputName: 'safe.zip',
      format: 'zip',
    }),
  ).toString('base64');
  try {
    await exec('python3', [
      '-c',
      `import os,sys,zipfile\nworker,root,arg=sys.argv[1:]\noriginal=os.open\ndone=False\ndef changed(path,flags,*args,**kwargs):\n global done\n if str(path).endswith('inside.txt') and not done:\n  done=True;os.rename(root+'/tree/sub',root+'/tree/old-sub');os.symlink(root+'/outside',root+'/tree/sub')\n return original(path,flags,*args,**kwargs)\nos.open=changed\nsys.argv=[worker,arg]\nexec(compile(open(worker).read(),worker,'exec'))`,
      decodeURIComponent(worker),
      dir,
      request,
    ]);
  } catch (error) {
    assert.match(error.stdout, /error/);
    await assert.rejects(access(dir + '/safe.zip'));
    return;
  }
  const { stdout } = await exec('python3', [
    '-c',
    "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read('tree/sub/inside.txt').decode())",
    dir + '/safe.zip',
  ]);
  assert.equal(stdout.trim(), 'inside');
});
