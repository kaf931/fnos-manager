import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('FPK unpack checks identity, version, architecture and rejects traversal or unsafe symlinks', async (t) => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'unpack-update-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  execFileSync('python3', [
    '-c',
    String.raw`
import io, tarfile, json, pathlib, sys
root=pathlib.Path(sys.argv[1])
def make(name,extra=None,platform='x86'):
 buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w:gz') as t:
  for file,data in [('package.json',json.dumps({'version':'0.3.5'}).encode()),('dist/index.html',b'html'),('server/index.js',b'js')]:
   info=tarfile.TarInfo(file);info.size=len(data);t.addfile(info,io.BytesIO(data))
  for folder in ['tools','node_modules']:
   info=tarfile.TarInfo(folder);info.type=tarfile.DIRTYPE;t.addfile(info)
  if extra:
   info=tarfile.TarInfo(extra[0]);info.type=tarfile.SYMTYPE if extra[1] else tarfile.REGTYPE;info.linkname=extra[1] or '';t.addfile(info)
 with tarfile.open(root/name,'w') as t:
  for file,data in [('manifest',f'appname=deskicons\nversion=0.3.5\nplatform={platform}\n'.encode()),('app.tgz',buf.getvalue())]:
   info=tarfile.TarInfo(file);info.size=len(data);t.addfile(info,io.BytesIO(data))
make('good.fpk');make('traversal.fpk',('../outside',None));make('symlink.fpk',('outside','../../outside'));make('arm.fpk',platform='arm')
`,
    d,
  ]);
  const run = (name, version = '0.3.5') =>
    spawnSync(
      'python3',
      [
        'backend/updates/unpack.py',
        path.join(d, name + '.fpk'),
        path.join(d, name + '-' + version),
        version,
        'x64',
      ],
      { encoding: 'utf8' },
    );
  assert.equal(run('good').status, 0);
  for (const name of ['traversal', 'symlink', 'arm']) assert.notEqual(run(name).status, 0, name);
  assert.notEqual(run('good', '0.3.6').status, 0);
});
