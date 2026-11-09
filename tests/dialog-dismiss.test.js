import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const built = await build({
  entryPoints: ['web/ui/react-dialog.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.png': 'dataurl' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { ReactDialog } = module.exports;
async function fixture(t) {
  const dom = new JSDOM('<main/>');
  const values = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [k, value] of Object.entries(values))
    Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const mediaListeners = new Set();
  const media = {
    matches: false,
    addEventListener: (_, listener) => mediaListeners.add(listener),
    removeEventListener: (_, listener) => mediaListeners.delete(listener),
  };
  dom.window.matchMedia = () => media;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const root = createRoot(document.querySelector('main'));
  let closes = 0;
  const render = async (busy = false) =>
    act(async () =>
      root.render(
        React.createElement(
          ReactDialog,
          { open: true, title: '编辑', busy, onClose: () => closes++ },
          React.createElement('p', null, '内容'),
        ),
      ),
    );
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  await render();
  const dialog = document.querySelector('dialog');
  dialog.getBoundingClientRect = () => ({ left: 0, right: 360, top: 100, bottom: 800 });
  const pointer = (type, x, y) =>
    dialog.dispatchEvent(
      new window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
    );
  return {
    render,
    pointer,
    closes: () => closes,
    resize(mobile) {
      media.matches = mobile;
      for (const listener of mediaListeners) listener();
    },
    unmount: () => root.render(null),
    listeners: () => mediaListeners.size,
  };
}
test('React dialog backdrop dismiss requires both pointer origin and click outside', async (t) => {
  const ui = await fixture(t);
  await ui.render();
  await act(() => {
    ui.pointer('pointerdown', 20, 150);
    ui.pointer('click', 20, 150);
  });
  assert.equal(ui.closes(), 0);
  await act(() => {
    ui.pointer('pointerdown', 20, 150);
    ui.pointer('click', 20, 20);
  });
  assert.equal(ui.closes(), 0, 'drag from dialog to backdrop is not dismissal');
  await act(() => {
    ui.pointer('pointerdown', 20, 20);
    ui.pointer('click', 20, 20);
  });
  assert.equal(ui.closes(), 1);
});
test('React busy state cancels backdrop dismissal until a later render permits it', async (t) => {
  const ui = await fixture(t);
  await ui.render(true);
  await act(() => {
    ui.pointer('pointerdown', 20, 20);
    ui.pointer('click', 20, 20);
  });
  assert.equal(ui.closes(), 0);
  await ui.render(false);
  await act(() => {
    ui.pointer('pointerdown', 20, 20);
    ui.pointer('click', 20, 20);
  });
  assert.equal(ui.closes(), 1);
});

test('dialog initially focuses its static title rather than the close button', async (t) => {
  await fixture(t);
  assert.equal(document.activeElement, document.querySelector('.dialog-header h2'));
  assert.equal(document.activeElement.tabIndex, -1);
  assert.notEqual(document.activeElement, document.querySelector('.dialog-close'));
});

test('an open dialog follows responsive changes and releases page mode on close', async (t) => {
  const ui = await fixture(t);
  const dialog = document.querySelector('dialog');
  await act(() => ui.resize(true));
  assert.equal(dialog.classList.contains('mobile-form-surface'), true);
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), true);
  await act(() => ui.resize(false));
  assert.equal(dialog.classList.contains('mobile-form-surface'), false);
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), false);
  await act(() => ui.resize(true));
  await act(() => ui.unmount());
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), false);
  assert.equal(ui.listeners(), 0);
});
