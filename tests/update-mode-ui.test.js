import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi, tick } from './fixtures/react-ui.js';
test('update mode uses public Select and saves manual/automatic choices', async (t) => {
  const calls = [],
    messages = [];
  const ui = await mountUi(t, 'update-mode', 'UpdateMode', {
    active: true,
    toast: (m) => messages.push(m),
    api: async (url, method, body) => {
      calls.push({ url, method, body });
      return { mode: body?.mode || 'manual' };
    },
  });
  const select = ui.get('select');
  assert.equal(select.value, 'manual');
  assert.deepEqual(
    [...select.options].map((x) => x.textContent),
    ['手动更新', '自动更新'],
  );
  await act(async () => {
    select.value = 'auto';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.deepEqual(calls.at(-1), {
    url: '/updates/settings',
    method: 'PUT',
    body: { mode: 'auto' },
  });
  assert.match(messages.at(-1), /空闲/);
});

test('download route uses the public Select and saves only its preference', async (t) => {
  const calls = [];
  const ui = await mountUi(t, 'update-mode', 'UpdateMode', {
    field: 'downloadRoute',
    active: true,
    toast: () => {},
    api: async (url, method, body) => {
      calls.push({ url, method, body });
      return { mode: 'auto', downloadRoute: body?.downloadRoute || 'direct' };
    },
  });
  const select = ui.get('select');
  assert.deepEqual(
    [...select.options].map((x) => x.value),
    ['direct', 'mirror'],
  );
  await act(async () => {
    select.value = 'mirror';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.deepEqual(calls.at(-1).body, { downloadRoute: 'mirror' });
  assert.equal(select.value, 'mirror');
});

test('update preference cannot be edited before the stored choice is loaded', async (t) => {
  let finish;
  const ui = await mountUi(t, 'update-mode', 'UpdateMode', {
    active: true,
    toast: () => {},
    api: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  assert.equal(ui.get('select').disabled, true);
  await act(async () => {
    finish({ mode: 'auto', downloadRoute: 'mirror' });
    await tick();
  });
  assert.equal(ui.get('select').disabled, false);
  assert.equal(ui.get('select').value, 'auto');
});

test('failed settings reads do not silently present editable default values', async (t) => {
  const messages = [];
  const ui = await mountUi(t, 'update-mode', 'UpdateMode', {
    active: true,
    toast: (message) => messages.push(message),
    api: async () => {
      throw new Error('读取设置失败');
    },
  });
  assert.equal(ui.get('select').disabled, true);
  assert.match(messages.join(' '), /读取设置失败/);
});
