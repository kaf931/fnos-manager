import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { GuacdRuntime } from '../server/rdp/runtime.js';
test('native runtime uses the guacd listen-port flag and terminates its child', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rdp-runtime-'));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const runtime = new GuacdRuntime(root, port);
  try {
    await mkdir(path.join(root, 'tools/rdp/bin'), { recursive: true });
    await writeFile(
      path.join(root, 'tools/rdp/bin/guacd'),
      `#!${process.execPath}\nconst net = require('node:net');const a=process.argv; if(!a.includes('-l') || a.includes('-p'))process.exit(1); const s=net.createServer(c=>c.end());s.listen(Number(a[a.indexOf('-l')+1]),'127.0.0.1');process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`,
      { mode: 0o755 },
    );
    await Promise.all([runtime.ensure(), runtime.ensure()]);
    await runtime.close();
    await assert.rejects(runtime.ensure(), /正在关闭/);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('missing native runtime returns an actionable error', async () => {
  const runtime = new GuacdRuntime('/nonexistent-rdp-test');
  await assert.rejects(runtime.ensure(), /引擎尚未安装/);
});

test('RDP engine certificate home persists across runtime restarts outside runtime files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rdp-trust-'));
  const data = path.join(root, 'data');
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  let runtime;
  try {
    await mkdir(path.join(root, 'tools/rdp/bin'), { recursive: true });
    await writeFile(
      path.join(root, 'tools/rdp/bin/guacd'),
      `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path'),net=require('node:net'); const cfg=process.env.XDG_CONFIG_HOME;if(!cfg||!cfg.startsWith(${JSON.stringify(data)}))process.exit(2);fs.writeFileSync(path.join(process.env.HOME,'engine-env.json'),JSON.stringify({home:process.env.HOME,config:cfg}));const a=process.argv,s=net.createServer(c=>c.end());s.listen(Number(a[a.indexOf('-l')+1]),'127.0.0.1');process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`,
      { mode: 0o755 },
    );
    runtime = new GuacdRuntime(root, port, data);
    await runtime.ensure();
    const home = path.join(data, 'rdp');
    const env = JSON.parse(await readFile(path.join(home, 'engine-env.json'), 'utf8'));
    assert.equal(env.home, home);
    assert.equal(env.config, path.join(home, '.config'));
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    await writeFile(path.join(home, '.config', 'known-hosts-test'), 'trusted');
    await runtime.close();
    runtime = new GuacdRuntime(root, port, data);
    await runtime.ensure();
    assert.equal(await readFile(path.join(home, '.config', 'known-hosts-test'), 'utf8'), 'trusted');
  } finally {
    await runtime?.close();
    await rm(root, { recursive: true, force: true });
  }
});
