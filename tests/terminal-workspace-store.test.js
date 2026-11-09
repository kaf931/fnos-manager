import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import { TerminalStore } from '../server/terminal/store.js';
import { WorkspaceStore } from '../server/terminal/workspace-store.js';
const folder = (name, parentId = null) => ({ kind: 'folder', scope: 'assets', name, parentId });
test('workspace validates ownership, cycles, depth, nonempty and credentials survive folder changes', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/workspace-');
  try {
    const s = await new TerminalStore(dir).init(),
      w = await new WorkspaceStore(dir, s).init();
    const a = await w.save('a', folder('A')),
      b = await w.save('a', folder('B', a.id));
    assert.deepEqual(w.list('b', 'assets'), []);
    await assert.rejects(w.save('b', folder('bad', a.id)));
    await assert.rejects(w.save('a', folder('A', b.id), a.id));
    await assert.rejects(w.remove('a', a.id));
    let parent = b;
    for (let n = 3; n <= 16; n++) parent = await w.save('a', folder('d' + n, parent.id));
    await assert.rejects(w.save('a', folder('too deep', parent.id)));
    const c = await s.save('a', {
      name: 'old',
      kind: 'local',
      username: 'a',
      authMethod: 'password',
      credentials: { password: 'secret' },
    });
    assert.equal(c.folderId, null);
    await s.save('a', { ...c, folderId: b.id }, c.id);
    assert.equal(s.getCredentials('a', c.id).password, 'secret');
    await assert.rejects(w.remove('a', b.id));
    await assert.rejects(
      s.save('b', { name: 'bad', kind: 'local', username: 'b', folderId: a.id }),
    );
    assert.equal((await stat(dir + '/nas-manager.sqlite')).mode & 0o777, 0o600);
    const loaded = await new WorkspaceStore(dir, s).init();
    assert.equal(loaded.list('a', 'assets').length, 16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('command byte and per-owner item limits plus invalid controls', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/workspace-');
  try {
    const w = await new WorkspaceStore(dir).init();
    const command = (content) => ({ kind: 'command', scope: 'commands', name: 'cmd', content });
    await w.save('a', command('x'.repeat(16384)));
    await assert.rejects(w.save('a', command('字'.repeat(6000))));
    await assert.rejects(w.save('a', command('bad\x1b')));
    await w.save('a', command('echo one\r\necho two'));
    for (let i = 2; i < 1000; i++) await w.save('a', command('pwd'));
    await assert.rejects(w.save('a', command('pwd')));
    await w.save('b', command('pwd'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('concurrent folder deletion and connection save cannot leave dangling reference', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/workspace-');
  try {
    const s = await new TerminalStore(dir).init(),
      w = await new WorkspaceStore(dir, s).init(),
      a = await w.save('a', folder('A'));
    await Promise.allSettled([
      w.remove('a', a.id),
      s.save('a', { name: 'c', kind: 'local', username: 'a', folderId: a.id }),
    ]);
    for (const c of s.list('a'))
      assert.ok(!c.folderId || w.list('a', 'assets').some((f) => f.id === c.folderId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
