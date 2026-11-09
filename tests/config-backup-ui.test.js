import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const built = await build({
  entryPoints: ['web/config-backup.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve({ filter: /native-select\.js$/ }, () => ({
          path: 'select',
          namespace: 'stub',
        }));
        b.onResolve({ filter: /task-pagination\.js$/ }, () => ({
          path: 'pagination',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
          loader: 'js',
          contents:
            a.path === 'select'
              ? `import React from 'react';export function NativeSelect({optionList,onChange,...props}){return React.createElement('select',{...props,onChange:e=>onChange(e.target.value)},optionList.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)));}`
              : `export const TaskPagination=()=>null;`,
        }));
        b.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: '' }));
      },
    },
  ],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { ConfigBackupDialog } = module.exports;
function dialogFixture(props) {
  const root = createRoot(document.querySelector('main'));
  let session = 0;
  const close = () => flushSync(() => root.render(null));
  return {
    open: (mode) =>
      flushSync(() =>
        root.render(
          React.createElement(ConfigBackupDialog, {
            ...props,
            mode,
            key: ++session,
            onClose: close,
          }),
        ),
      ),
    dispose: () => flushSync(() => root.unmount()),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
test('backup defaults to no credentials; restore previews, skips conflicts and retries the same operation', async (t) => {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const values = {
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    matchMedia: () => ({ matches: false }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = {};
  for (const [k, v] of Object.entries(values)) {
    previous[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
  let calls = [],
    restoreAttempts = 0,
    restored = 0,
    pendingPreview = null;
  const preview = {
    token: 'test',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    counts: { connections: 1 },
    warnings: [],
    rows: [
      {
        key: 'connections:one',
        id: 'one',
        kind: 'connections',
        name: '现有连接',
        conflict: true,
        defaultAction: 'skip',
        dependencies: [],
        candidates: [],
        warnings: [],
      },
    ],
  };
  const manager = dialogFixture({
    api: async (route, _method, body) => {
      calls.push({ route, body });
      if (route === '/backup/preview') return pendingPreview || preview;
      if (route === '/backup/restore') {
        restoreAttempts++;
        if (restoreAttempts === 1) throw Error('网络暂时不可用');
        return { imported: 1, skipped: 0, mapped: 0, requestId: body.requestId };
      }
      return {};
    },
    toast: () => {},
    onRestored: async () => {
      restored++;
    },
  });
  t.after(async () => {
    await act(async () => manager.dispose());
    dom.window.close();
    for (const k of Object.keys(values)) {
      if (previous[k]) Object.defineProperty(globalThis, k, previous[k]);
      else delete globalThis[k];
    }
  });
  await act(() => manager.open('export'));
  assert.equal(document.querySelector('[aria-label="包含认证凭据"]').checked, false);
  await act(() => manager.open('restore'));
  const input = document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', {
    value: [{ name: 'config.json', size: 100, text: async () => '{"format":"test"}' }],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.equal(calls.filter((c) => c.route === '/backup/preview').length, 1);
  assert.equal(document.querySelector('[aria-label="处理 现有连接"]').value, 'skip');
  const select = document.querySelector('[aria-label="处理 现有连接"]');
  await act(() => {
    select.value = 'import';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const button = () =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent === '确认导入' || b.textContent === '重试导入',
    );
  await act(async () => {
    button().click();
    button().click();
    await tick();
  });
  assert.equal(restoreAttempts, 1);
  assert.match(document.body.textContent, /网络暂时不可用/);
  await act(async () => {
    button().click();
    await tick();
  });
  assert.equal(restoreAttempts, 2);
  const restores = calls.filter((c) => c.route === '/backup/restore');
  assert.equal(restores[0].body.requestId, restores[1].body.requestId);
  assert.equal(restored, 1);
  assert.match(document.body.textContent, /导入完成/);
  let resolvePreview;
  pendingPreview = new Promise((resolve) => {
    resolvePreview = resolve;
  });
  await act(() => manager.open('restore'));
  const delayedInput = document.querySelector('input[type=file]');
  Object.defineProperty(delayedInput, 'files', {
    value: [{ name: 'pending.json', size: 2, text: async () => '{}' }],
  });
  await act(async () => {
    delayedInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick();
  });
  const close = document.querySelector('button.dialog-close');
  assert.equal(close.disabled, false);
  await act(() => close.click());
  assert.equal(document.querySelector('dialog'), null);
  await act(async () => {
    resolvePreview(preview);
    await tick();
  });
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.querySelector('table'), null);
  pendingPreview = null;
  preview.rows = [
    {
      key: 'connections:c',
      id: 'c',
      kind: 'connections',
      name: '关联连接',
      conflict: true,
      defaultAction: 'skip',
      dependencies: [],
      candidates: [{ id: 'existing', name: '已有远程连接' }],
      warnings: [],
    },
    {
      key: 'devices:d',
      id: 'd',
      kind: 'devices',
      name: '待恢复设备',
      conflict: false,
      defaultAction: 'import',
      dependencies: ['connections:c'],
      candidates: [],
      warnings: [],
    },
  ];
  await act(() => manager.open('restore'));
  const mappingInput = document.querySelector('input[type=file]');
  Object.defineProperty(mappingInput, 'files', {
    value: [{ name: 'mapping.json', size: 2, text: async () => '{}' }],
  });
  await act(async () => {
    mappingInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.equal(button().disabled, true);
  const action = document.querySelector('[aria-label="处理 关联连接"]');
  await act(() => {
    action.value = 'map';
    action.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  assert.equal(button().disabled, true);
  const target = document.querySelector('[aria-label="关联 关联连接"]');
  await act(() => {
    target.value = 'existing';
    target.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  assert.equal(button().disabled, false);
  await act(async () => {
    button().click();
    await tick();
  });
  const last = calls.filter((c) => c.route === '/backup/restore').at(-1);
  assert.equal(last.body.decisions.find((d) => d.key === 'connections:c').targetId, 'existing');
});
