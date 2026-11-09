import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import { validateConnection } from '../server/terminal/model.js';
import { TerminalStore } from '../server/terminal/store.js';
test('validates connection fields and forces local loopback', () => {
  assert.deepEqual(
    validateConnection({ name: '本机', kind: 'local', host: 'evil', username: 'demo' }),
    { name: '本机', kind: 'local', host: '127.0.0.1', port: 22, username: 'demo' },
  );
  for (const patch of [
    { port: 0 },
    { port: 65536 },
    { kind: 'shell' },
    { host: 'http://nas' },
    { username: 'a\nb' },
    { host: '-oProxyCommand=x' },
    { host: 'nas/path' },
  ])
    assert.throws(() =>
      validateConnection({
        name: '远程',
        kind: 'remote',
        host: 'nas.local',
        username: 'demo',
        ...patch,
      }),
    );
  assert.equal(
    validateConnection({ name: 'v6', kind: 'remote', host: '::1', username: 'demo' }).host,
    '::1',
  );
});
test('store isolates owners, persists trust and excludes credentials', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/terminal-store-');
  try {
    let s = await new TerminalStore(dir).init();
    const c = await s.save('1000', {
      name: '本机',
      kind: 'local',
      username: 'demo',
      password: 'never-store',
      privateKey: 'secret',
      passphrase: 'secret',
    });
    assert.equal(s.list('1001').length, 0);
    assert.throws(() => s.get('1001', c.id), { status: 404 });
    await s.trustHostKey('1000', {
      host: c.host,
      port: c.port,
      algorithm: 'ssh-ed25519',
      key: 'public-key',
      fingerprint: 'SHA256:test',
    });
    s = await new TerminalStore(dir).init();
    assert.equal(s.get('1000', c.id).name, '本机');
    assert.equal(s.getHostKey('1000', c.host, 22, 'ssh-ed25519').fingerprint, 'SHA256:test');
    assert.equal(s.getHostKey('1001', c.host, 22, 'ssh-ed25519'), undefined);
    const text = await readFile(dir + '/nas-manager.sqlite', 'utf8');
    assert.ok(!/never-store|privateKey|passphrase/.test(text));
    assert.equal((await stat(dir + '/terminal')).mode & 0o777, 0o700);
    assert.equal((await stat(dir + '/nas-manager.sqlite')).mode & 0o777, 0o600);
    await s.remove('1000', c.id);
    assert.equal(s.list('1000').length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
