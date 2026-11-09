import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi } from './fixtures/react-ui.js';
import { deferred } from './helpers/remote-react-fixture.js';

test('completed duplicate processing remains finished when refreshing the scan fails', async (t) => {
  let writes = 0;
  const messages = [];
  const ui = await mountUi(t, 'storage-duplicate-manager', 'DuplicateManager', {
    job: { id: 'scan' },
    groups: [{ size: 4, paths: ['/a/file', '/b/file'] }],
    api: async () => {
      writes++;
      return { results: [{ path: '/b/file', success: true }] };
    },
    pickDirectory: async () => '/target',
    onProcessed: async () => {
      throw Error('refresh failed');
    },
    toast: (message) => messages.push(message),
  });
  await act(() => ui.get('[data-directory]').click());
  await act(() => ui.get('[data-execute]').click());
  await act(() => ui.get('[data-execute]').click());
  assert.equal(writes, 1);
  assert.equal(ui.get('[data-execute]').hidden, true);
  assert.match(ui.get('[data-results]').textContent, /已处理 1 \/ 1/);
  assert.match(messages.join(' '), /处理.*刷新/);
  await act(() => ui.get('[data-execute]').click());
  assert.equal(writes, 1);
});

test('choosing a duplicate destination blocks execution until the picker settles', async (t) => {
  const pending = deferred();
  let picks = 0;
  const ui = await mountUi(t, 'storage-duplicate-manager', 'DuplicateManager', {
    job: { id: 'scan' },
    groups: [{ size: 4, paths: ['/a/file', '/b/file'] }],
    api: async () => assert.fail('must not process during directory selection'),
    pickDirectory: () => (++picks === 1 ? Promise.resolve('/target') : pending.promise),
    onProcessed: async () => {},
    toast() {},
  });
  await act(() => ui.get('[data-directory]').click());
  await act(() => ui.get('[data-execute]').click());
  await act(() => ui.get('[data-directory]').click());
  assert.equal(ui.get('[data-execute]').disabled, true);
  await act(() => pending.reject(Error('目录选择失败')));
  assert.match(ui.get('[data-error]').textContent, /目录选择失败/);
  assert.equal(ui.get('[data-execute]').disabled, false);
});
