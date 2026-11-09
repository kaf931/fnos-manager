import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import { TerminalStore } from '../server/terminal/store.js';
import { sshFixture } from './fixtures/ssh-server.js';
const base = { name: 'test', kind: 'local', port: 22, username: 'tester', authMethod: 'password' };
test('saved password is plaintext, returned to owner and persists without a key', async () => {
  const dir = await mkdtemp(os.tmpdir() + '/ssh-credentials-');
  try {
    let store = await new TerminalStore(dir).init();
    const c = await store.save('1000', {
      ...base,
      credentials: { password: 'fixture-saved-secret' },
    });
    assert.equal(c.authMethod, 'password');
    assert.equal(c.hasCredentials, true);
    assert.equal(c.credentialBox, undefined);
    assert.equal(c.credentials.password, 'fixture-saved-secret');
    assert.deepEqual(store.list('1001'), []);
    assert.equal(store.repository.find('1000', c.id).credentials.password, 'fixture-saved-secret');
    await assert.rejects(() => stat(dir + '/terminal/credential.key'), { code: 'ENOENT' });
    assert.throws(() => store.getCredentials('1001', c.id), { status: 404 });
    store = await new TerminalStore(dir).init();
    assert.deepEqual(store.getCredentials('1000', c.id), {
      method: 'password',
      password: 'fixture-saved-secret',
    });
    await store.save('1000', { ...base, name: 'renamed', credentials: { password: '' } }, c.id);
    assert.equal(store.getCredentials('1000', c.id).password, 'fixture-saved-secret');
    await assert.rejects(() =>
      store.save('1000', { ...base, username: 'other', credentials: {} }, c.id),
    );
    assert.equal(store.get('1000', c.id).username, 'tester');
    await store.remove('1000', c.id);
    assert.throws(() => store.getCredentials('1000', c.id), { status: 404 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('private key and passphrase save together; changed authentication requires new credentials', async () => {
  const fixture = await sshFixture(),
    dir = await mkdtemp(os.tmpdir() + '/ssh-key-store-');
  try {
    const store = await new TerminalStore(dir).init();
    const c = await store.save('1000', {
      ...base,
      authMethod: 'privateKey',
      credentials: { privateKey: fixture.encryptedKey, passphrase: 'fixture-passphrase' },
    });
    assert.equal(c.authMethod, 'privateKey');
    assert.equal(store.getCredentials('1000', c.id).passphrase, 'fixture-passphrase');
    await store.save('1000', { ...base, authMethod: 'privateKey', credentials: {} }, c.id);
    await assert.rejects(() => store.save('1000', { ...base, credentials: {} }, c.id));
    await assert.rejects(() =>
      store.save(
        '1000',
        { ...base, authMethod: 'privateKey', credentials: { privateKey: 'not-a-key' } },
        c.id,
      ),
    );
    await store.save('1000', { ...base, credentials: { password: 'replacement' } }, c.id);
    assert.deepEqual(store.getCredentials('1000', c.id), {
      method: 'password',
      password: 'replacement',
    });
    assert.equal(c.credentials.privateKey, fixture.encryptedKey);
    assert.equal(c.credentials.passphrase, 'fixture-passphrase');
  } finally {
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
