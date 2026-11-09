import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { mountUi } from './fixtures/react-ui.js';
import { deferred } from './helpers/remote-react-fixture.js';

async function editor(t, props = {}) {
  return mountUi(t, 'features/terminal/connection-editor', 'ConnectionEditor', {
    connection: null,
    api: async () => ({}),
    toast() {},
    onSave() {},
    ...props,
  });
}
async function chooseFile(ui, read) {
  const input = ui.get('input[type=file]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name: 'id_ed25519', size: 32, text: read }],
  });
  await act(() => Simulate.change(input));
}

test('private key selection keeps the newest file when reads finish out of order', async (t) => {
  const ui = await editor(t),
    first = deferred(),
    second = deferred();
  await act(() => document.querySelectorAll('input[type=radio]')[1].click());
  await chooseFile(ui, () => first.promise);
  await chooseFile(ui, () => second.promise);
  await act(() => second.resolve('second-key'));
  await act(() => first.resolve('first-key'));
  assert.equal(ui.get('textarea').value, 'second-key');
});

test('editing a private key manually invalidates an unfinished file read', async (t) => {
  const ui = await editor(t),
    pending = deferred();
  await act(() => document.querySelectorAll('input[type=radio]')[1].click());
  await chooseFile(ui, () => pending.promise);
  await act(() => {
    ui.get('textarea').value = 'pasted-key';
    Simulate.change(ui.get('textarea'));
  });
  await act(() => pending.resolve('old-file-key'));
  assert.equal(ui.get('textarea').value, 'pasted-key');
});

test('private key read failures are visible and allow selecting the file again', async (t) => {
  const ui = await editor(t),
    pending = deferred();
  await act(() => document.querySelectorAll('input[type=radio]')[1].click());
  await chooseFile(ui, () => pending.promise);
  assert.equal(ui.get('button[type=submit]').disabled, true);
  await act(() => pending.reject(new Error('unreadable')));
  assert.match(ui.get('[role=alert]').textContent, /读取.*失败/);
  await chooseFile(ui, async () => 'retry-key');
  assert.equal(ui.get('textarea').value, 'retry-key');
  assert.ok(!ui.get('[role=alert]'));
  assert.equal(ui.get('button[type=submit]').disabled, false);
});

test('connection saving holds the editor open and unlocks it after a failed write', async (t) => {
  const pending = deferred();
  let writes = 0,
    refreshed = 0;
  const ui = await editor(t, {
    api: () => (++writes === 1 ? pending.promise : Promise.resolve({})),
    onSave: () => refreshed++,
  });
  const submit = () =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await act(() => {
    submit();
    submit();
  });
  assert.equal(writes, 1);
  await act(() => ui.get('.dialog-footer button[type=button]').click());
  assert.ok(ui.get('dialog'));
  assert.equal(ui.get('#terminal-name').disabled, true);
  await act(() => pending.reject(new Error('保存失败')));
  assert.match(ui.get('[role=alert]').textContent, /保存失败/);
  assert.equal(ui.get('#terminal-name').disabled, false);
  await act(submit);
  assert.equal(refreshed, 1);
  assert.ok(!ui.get('dialog'));
});
