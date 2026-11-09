import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StorageService } from '../server/storage/service.js';
import { DuplicateService } from '../server/storage/duplicates.js';
async function fixture(fn) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'duplicate-action-')));
  let actions;
  try {
    await mkdir(dir + '/source');
    await mkdir(dir + '/target');
    await writeFile(dir + '/source/keep', 'same');
    await writeFile(dir + '/source/copy', 'same');
    const storage = await new StorageService({ dataDir: dir + '/app', roots: [dir] }).init();
    storage.jobs.set('scan', {
      id: 'scan',
      owner: 'owner',
      path: dir + '/source',
      mode: 'duplicates',
      status: 'completed',
      result: { groups: [{ size: 4, paths: [dir + '/source/keep', dir + '/source/copy'] }] },
    });
    actions = new DuplicateService(storage);
    await fn({
      dir,
      storage,
      actions,
      input: {
        confirmed: true,
        items: [{ keep: dir + '/source/keep', path: dir + '/source/copy' }],
      },
    });
  } finally {
    await actions?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test('duplicate deletion verifies content and preserves keeper', () =>
  fixture(async ({ dir, actions, input, storage }) => {
    const result = await actions.process('owner', 'scan', { ...input, action: 'delete' });
    assert.equal(result.results[0].success, true);
    assert.equal(await readFile(dir + '/source/keep', 'utf8'), 'same');
    await assert.rejects(access(dir + '/source/copy'));
    assert.equal(storage.get('owner', 'scan').duplicateActions[0].success, true);
  }));
test('duplicate move preserves keeper and refuses overwrite', () =>
  fixture(async ({ dir, actions, input }) => {
    await writeFile(dir + '/target/copy', 'existing');
    const failed = await actions.process('owner', 'scan', {
      ...input,
      action: 'move',
      destination: dir + '/target',
    });
    assert.equal(failed.results[0].success, false);
    assert.equal(await readFile(dir + '/source/copy', 'utf8'), 'same');
    assert.equal(await readFile(dir + '/target/copy', 'utf8'), 'existing');
    await rm(dir + '/target/copy');
    const ok = await actions.process('owner', 'scan', {
      ...input,
      action: 'move',
      destination: dir + '/target',
    });
    assert.equal(ok.results[0].success, true);
    assert.equal(await readFile(dir + '/target/copy', 'utf8'), 'same');
    await assert.rejects(access(dir + '/source/copy'));
  }));
test('changed content is never deleted; forged owner or keep path is rejected', () =>
  fixture(async ({ dir, actions, input }) => {
    await writeFile(dir + '/source/copy', 'edit');
    const result = await actions.process('owner', 'scan', { ...input, action: 'delete' });
    assert.equal(result.results[0].success, false);
    assert.equal(await readFile(dir + '/source/copy', 'utf8'), 'edit');
    await assert.rejects(actions.process('other', 'scan', { ...input, action: 'delete' }));
    await assert.rejects(
      actions.process('owner', 'scan', {
        ...input,
        action: 'delete',
        items: [{ keep: '/outside', path: dir + '/source/copy' }],
      }),
    );
  }));
