import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadPackage } from '../server/updates/download.js';
import { installRuntime } from '../server/updates/install.js';
import { UpdateManager } from '../server/updates/manager.js';
const url = 'https://github.com/kaf931/fnos-manager/releases/download/0.3.5/app.fpk';
async function dir(t) {
  const d = await mkdtemp(path.join(os.tmpdir(), 'self-update-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}
test('download validates exact size and digest and reports bytes', async (t) => {
  const d = await dir(t),
    body = Buffer.from('release'),
    progress = [];
  const spec = { url, size: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  await downloadPackage(
    spec,
    path.join(d, 'ok'),
    async (n) => {
      progress.push(n);
    },
    async () => new Response(body),
  );
  assert.equal(await readFile(path.join(d, 'ok'), 'utf8'), 'release');
  assert.equal(progress.at(-1), 7);
  await assert.rejects(
    downloadPackage(
      { ...spec, sha256: '0'.repeat(64) },
      path.join(d, 'bad'),
      async () => {},
      async () => new Response(body),
    ),
    /SHA-256/,
  );
  await assert.rejects(
    downloadPackage(
      spec,
      path.join(d, 'long'),
      async () => {},
      async () => new Response('too much data'),
    ),
    /预期大小/,
  );
  await assert.rejects(
    downloadPackage(
      spec,
      path.join(d, 'redirect'),
      async () => {},
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    ),
    /重定向/,
  );
  await assert.rejects(
    downloadPackage(
      { ...spec, url: 'https://evil.test/a' },
      path.join(d, 'source'),
      async () => {},
    ),
    /来源/,
  );
});
test('runtime update preserves data and rolls back code plus database when new health check fails', async (t) => {
  const d = await dir(t),
    root = path.join(d, 'root'),
    data = path.join(d, 'data'),
    jobDir = path.join(data, 'job'),
    stage = path.join(jobDir, 'stage');
  await mkdir(root);
  await mkdir(stage, { recursive: true });
  for (const part of ['dist', 'server', 'tools', 'node_modules']) {
    await mkdir(path.join(root, part));
    await writeFile(path.join(root, part, 'old'), 'old');
    await mkdir(path.join(stage, part));
    await writeFile(path.join(stage, part, 'new'), 'new');
  }
  await writeFile(path.join(root, 'package.json'), 'old');
  await writeFile(path.join(stage, 'package.json'), 'new');
  await writeFile(path.join(data, 'nas-manager.sqlite'), 'original database');
  await writeFile(path.join(data, 'credential.key'), 'keep secret');
  const actions = [],
    phases = [];
  let once = true;
  await installRuntime(
    { root, dataDir: data, jobDir, version: '0.3.5', previousVersion: '0.3.4' },
    stage,
    async (p) => {
      phases.push(p);
    },
    {
      service: async (_, a) => {
        actions.push(a);
      },
      checkDatabase: () => {},
      counts: () => ({}),
      health: async (_, version) => {
        if (once) {
          once = false;
          await writeFile(path.join(data, 'nas-manager.sqlite'), 'changed schema');
          throw new Error('bad update');
        }
        assert.equal(version, '0.3.4');
      },
    },
  );
  assert.equal(phases.at(-1), 'rolled-back');
  assert.deepEqual(actions, ['stop', 'start', 'stop', 'start']);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), 'old');
  assert.equal(await readFile(path.join(data, 'nas-manager.sqlite'), 'utf8'), 'original database');
  assert.equal(await readFile(path.join(data, 'credential.key'), 'utf8'), 'keep secret');
});
test('development runtime cannot start a self update or accept an arbitrary URL', async (t) => {
  const d = await dir(t),
    manager = new UpdateManager(d, d, '0.3.4', false);
  assert.equal(await manager.supported(), false);
  await assert.rejects(manager.start({ hasUpdate: true, latest: '0.3.5' }, '0.3.5'), /不支持/);
  assert.equal(await manager.status(), null);
});

test('successful update switches runtime without touching credentials or database', async (t) => {
  const d = await dir(t),
    root = path.join(d, 'root'),
    data = path.join(d, 'data'),
    jobDir = path.join(data, 'job'),
    stage = path.join(jobDir, 'stage');
  await mkdir(root);
  await mkdir(stage, { recursive: true });
  for (const part of ['dist', 'server', 'tools', 'node_modules']) {
    await mkdir(path.join(root, part));
    await mkdir(path.join(stage, part));
  }
  await writeFile(path.join(root, 'package.json'), 'old');
  await writeFile(path.join(stage, 'package.json'), 'new');
  await writeFile(path.join(data, 'nas-manager.sqlite'), 'database');
  await writeFile(path.join(data, 'credential.key'), 'key');
  const actions = [],
    phases = [];
  await installRuntime(
    { root, dataDir: data, jobDir, version: '0.3.5', previousVersion: '0.3.4' },
    stage,
    async (p) => {
      phases.push(p);
    },
    {
      service: async (_, action) => {
        actions.push(action);
      },
      checkDatabase: () => {},
      counts: () => ({ icons: 1 }),
      health: async (_, version) => {
        assert.equal(version, '0.3.5');
      },
    },
  );
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(data, 'nas-manager.sqlite'), 'utf8'), 'database');
  assert.equal(await readFile(path.join(data, 'credential.key'), 'utf8'), 'key');
  assert.equal(phases.at(-1), 'completed');
  assert.deepEqual(actions, ['stop', 'start']);
});

for (const withdrawn of [false, true])
  test(`independent update worker validates a ${withdrawn ? 'withdrawn' : 'published'} release before replacing the simulated NAS service`, async (t) => {
    const { execFileSync } = await import('node:child_process');
    const { runUpdate } = await import('../server/updates/worker.js');
    const { service } = await import('../server/updates/install.js');
    const { writeJob, readJob } = await import('../server/updates/job.js');
    const { DatabaseSync } = await import('node:sqlite');
    const d = await mkdtemp(path.join(os.tmpdir(), 'self-update-')),
      root = path.join(d, 'root'),
      data = path.join(d, 'data'),
      jobDir = path.join(data, 'job'),
      payload = path.join(d, 'payload');
    await mkdir(root);
    await mkdir(jobDir, { recursive: true });
    await mkdir(path.join(payload, 'server'), { recursive: true });
    await mkdir(path.join(payload, 'dist'));
    await mkdir(path.join(payload, 'node_modules'));
    await mkdir(path.join(payload, 'tools'));
    await writeFile(
      path.join(payload, 'package.json'),
      JSON.stringify({ version: '0.3.5', type: 'module' }),
    );
    await writeFile(path.join(payload, 'dist/index.html'), 'html');
    await writeFile(
      path.join(payload, 'server/index.js'),
      `import http from 'node:http';import fs from 'node:fs';const socket=process.env.TRIM_APPDEST+'/app.sock';try{fs.unlinkSync(socket)}catch{};const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.endsWith('/state')?{version:'0.3.5'}:{}));});server.listen(socket);process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
    );
    await writeFile(path.join(root, 'package.json'), '{"version":"0.3.4"}');
    const db = new DatabaseSync(path.join(data, 'nas-manager.sqlite'));
    db.exec("CREATE TABLE icons(id TEXT); INSERT INTO icons VALUES ('keep')");
    db.close();
    const script = path.join(d, 'service.sh');
    await writeFile(
      script,
      `#!/bin/sh\ncase "$1" in\nstart) cd "$TRIM_APPDEST"; nohup '${process.execPath}' server/index.js >/dev/null 2>&1 </dev/null & echo $! > "$TRIM_PKGVAR/service.pid";;\nstop) if [ -f "$TRIM_PKGVAR/service.pid" ]; then kill "$(cat "$TRIM_PKGVAR/service.pid")" 2>/dev/null || true; sleep 1; fi;;\nesac\n`,
      { mode: 0o755 },
    );
    const packageFile = path.join(d, 'release.fpk');
    execFileSync('python3', [
      '-c',
      `import tarfile,io,pathlib,sys\np=pathlib.Path(sys.argv[1]);b=io.BytesIO()\nwith tarfile.open(fileobj=b,mode='w:gz') as t:\n for x in p.iterdir():t.add(x,arcname=x.name)\nwith tarfile.open(sys.argv[2],'w') as t:\n for name,data in [('manifest',b'appname=deskicons\\nversion=0.3.5\\nplatform=x86\\n'),('app.tgz',b.getvalue())]:\n  info=tarfile.TarInfo(name);info.size=len(data);t.addfile(info,io.BytesIO(data))`,
      payload,
      packageFile,
    ]);
    const bytes = await readFile(packageFile),
      spec = {
        root,
        dataDir: data,
        jobDir,
        serviceScript: script,
        version: '0.3.5',
        previousVersion: '0.3.4',
        architecture: 'x64',
        asset: {
          url,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
    t.after(async () => {
      await service(spec, 'stop');
      await rm(d, { recursive: true, force: true });
    });
    t.mock.method(globalThis, 'fetch', async (address) =>
      String(address).startsWith('https://api.github.com/')
        ? withdrawn
          ? new Response('', { status: 404 })
          : Response.json({
              tag_name: '0.3.5',
              assets: [
                {
                  name: 'NAS.-0.3.5-x86_64.fpk',
                  browser_download_url: url,
                  size: bytes.length,
                  digest: 'sha256:' + spec.asset.sha256,
                },
              ],
            })
        : new Response(bytes),
    );
    await writeJob(path.join(jobDir, 'status.json'), {
      id: 'simulation',
      version: '0.3.5',
      phase: 'downloading',
      received: 0,
      total: bytes.length,
      message: '',
      pid: 0,
      updatedAt: Date.now(),
    });
    await runUpdate(spec);
    const result = await readJob(path.join(jobDir, 'status.json'));
    if (withdrawn) {
      assert.equal(result.phase, 'cancelled', result.message);
      assert.match(result.message, /撤回/);
      assert.equal(
        JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
        '0.3.4',
      );
      return;
    }
    assert.equal(result.phase, 'completed', result.message);
    assert.equal(result.received, bytes.length);
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
      '0.3.5',
    );
    const after = new DatabaseSync(path.join(data, 'nas-manager.sqlite'));
    assert.equal(after.prepare('SELECT id FROM icons').get().id, 'keep');
    after.close();
  });

test('configuration acceptance includes SSH connections', async (t) => {
  const { configurationCounts } = await import('../server/updates/install.js');
  const { DatabaseSync } = await import('node:sqlite');
  const d = await dir(t),
    file = path.join(d, 'counts.sqlite');
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE ssh_connections(id TEXT); INSERT INTO ssh_connections VALUES ('ssh');");
  db.close();
  assert.deepEqual(configurationCounts(file), { ssh_connections: 1 });
});

test('worker launched through a symlink executes its entry point', async (t) => {
  const { symlink } = await import('node:fs/promises');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const d = await dir(t);
  const link = path.join(d, 'runtime');
  await symlink(path.resolve('server/updates'), link, 'dir');
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      path.join(link, 'worker.js'),
      path.join(d, 'missing-spec.json'),
    ]),
    (error) => /ENOENT/.test(error.stderr) && /missing-spec/.test(error.stderr),
  );
});

test('an older database schema is rejected before stopping the running service with explicit version details', async (t) => {
  const { validateDatabaseCompatibility } = await import('../server/updates/install.js');
  const { DatabaseSync } = await import('node:sqlite');
  const d = await dir(t);
  const stage = path.join(d, 'stage');
  await mkdir(path.join(stage, 'server/persistence'), { recursive: true });
  const db = new DatabaseSync(path.join(d, 'nas-manager.sqlite'));
  db.exec('PRAGMA user_version=26');
  db.close();
  await writeFile(
    path.join(stage, 'server/persistence/schema.js'),
    'export const SCHEMA_VERSION = 23;',
  );
  await assert.rejects(
    validateDatabaseCompatibility({ dataDir: d, version: '0.3.5' }, stage),
    /0\.3\.5.*23.*26.*旧代码包/,
  );
  let stops = 0;
  await assert.rejects(
    installRuntime({ dataDir: d, version: '0.3.5', jobDir: d }, stage, async () => {}, {
      service: async () => stops++,
    }),
    /数据库版本/,
  );
  assert.equal(stops, 0);
  await writeFile(
    path.join(stage, 'server/persistence/schema.js'),
    'export const SCHEMA_VERSION = 26;',
  );
  await validateDatabaseCompatibility({ dataDir: d, version: '0.3.6' }, stage);
});
