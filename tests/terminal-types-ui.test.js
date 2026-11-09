import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { TerminalAssets } from '../.web-test/terminal-assets.js';
import { editPermissions, editArchive } from '../.web-test/terminal-file-actions.js';
import { RemoteDialogHost } from '../.web-test/features/terminal/dialogs.js';
import { decodeTerminalEvent } from '../.web-test/terminal-protocol.js';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
test('React asset tree ignores stale refreshes and escapes names', async (t) => {
  const ui = remoteFixture(t),
    pending = deferred();
  let calls = 0;
  const folders = [{ id: 'folder', name: '目录', kind: 'folder', scope: 'assets', parentId: null }],
    connections = [
      { id: 'one', name: '<img src=x>', kind: 'remote', host: 'nas', username: 'root', port: 22 },
    ];
  const options = {
    open: true,
    scope: 'assets',
    revision: 0,
    api: (path) =>
      path === '/terminal/connections'
        ? Promise.resolve(connections)
        : ['/vnc/connections', '/rdp/connections', '/adb/connections'].includes(path)
          ? Promise.resolve([])
          : ++calls === 1
            ? pending.promise
            : Promise.resolve(folders),
    openConnection() {},
    editConnection() {},
    sendCommand() {},
    onClose() {},
    confirm: async () => false,
  };
  await ui.render(TerminalAssets, options);
  await ui.render(TerminalAssets, { ...options, revision: 1 });
  await act(() => pending.resolve([{ ...folders[0], name: 'stale' }]));
  assert.match(ui.document.querySelector('aside').textContent, /目录/);
  assert.doesNotMatch(ui.document.querySelector('aside').textContent, /stale/);
  assert.equal(ui.document.querySelector('img'), null);
  await act(() => ui.document.querySelector('.terminal-tree-more').click());
  assert.equal(ui.document.querySelectorAll('[role=menuitem]').length, 4);
  await ui.unmount();
  assert.equal(ui.document.querySelector('[role=menu]'), null);
});
test('permission and archive dialogs retain state and settle via React ownership', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(RemoteDialogHost, {});
  let result;
  await act(() => {
    result = editPermissions('a.txt', { mode: 0o4644, uid: 10, gid: 20 });
  });
  const box = ui.document.querySelector('input[aria-label="其他人 执行"]');
  await act(() => box.click());
  assert.equal(ui.document.querySelector('input[type=text]').value, '4645');
  await act(() =>
    ui.document
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(await result, { mode: 0o4645 });
  assert.equal(ui.document.querySelector('dialog'), null);
  await act(() => {
    result = editArchive('file');
  });
  assert.equal(ui.document.querySelector('input').value, 'file.zip');
  await act(() => ui.document.querySelector('.dialog-footer button').click());
  assert.equal(await result, null);
  assert.equal(ui.document.querySelector('dialog'), null);
});

test('archive names are validated inside the editor without discarding the form', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(RemoteDialogHost, {});
  let result;
  await act(() => {
    result = editArchive('file');
  });
  const input = ui.document.querySelector('input');
  await act(() => {
    input.value = '../invalid.zip';
    Simulate.change(input);
  });
  await act(() =>
    ui.document
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.ok(ui.document.querySelector('dialog'));
  assert.match(ui.document.querySelector('[role=alert]').textContent, /有效名称/);
  await act(() => {
    input.value = 'valid.zip';
    Simulate.change(input);
  });
  await act(() =>
    ui.document
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(await result, { outputName: 'valid.zip', format: 'zip' });
});
test('terminal transport validates event variants before publishing UI state', () => {
  assert.deepEqual(decodeTerminalEvent({ type: 'state', state: 'connected' }), {
    type: 'state',
    state: 'connected',
  });
  assert.deepEqual(decodeTerminalEvent({ type: 'output', data: 'eA==', seq: 2 }), {
    type: 'output',
    data: 'eA==',
    seq: 2,
  });
  assert.equal(decodeTerminalEvent({ type: 'future-extension' }), null);
  assert.equal(decodeTerminalEvent(null), null);
  assert.throws(() => decodeTerminalEvent({ type: 'state', state: 'constructor' }), /响应/);
  assert.throws(
    () =>
      decodeTerminalEvent({
        type: 'host-key',
        host: 'nas',
        port: 22,
        algorithm: 'ed25519',
        fingerprint: 'x',
        changed: true,
        previousFingerprints: [3],
      }),
    /响应/,
  );
});
