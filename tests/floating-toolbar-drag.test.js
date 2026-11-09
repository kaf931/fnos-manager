import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { act } from 'react';
import { remoteFixture } from './helpers/remote-react-fixture.js';
const result = await build({
  entryPoints: ['web/vnc-floating-tools.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
function pointer(target, type, x, y) {
  const event = new window.Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y });
  target.dispatchEvent(event);
}
async function fixture(t) {
  const ui = remoteFixture(t);
  await ui.render(module.exports.VncFloatingTools, { children: 'tools' });
  const rail = ui.document.querySelector('[role=toolbar]'),
    handle = rail.querySelector('button'),
    parent = rail.parentElement;
  parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 500 });
  rail.getBoundingClientRect = () => ({ left: 8, top: 16, width: 50, height: 200 });
  handle.setPointerCapture = () => {};
  handle.releasePointerCapture = () => {};
  return { ui, rail, handle, parent };
}
test('dragging fullscreen handle clamps to viewport and does not collapse on release', async (t) => {
  const { rail, handle } = await fixture(t);
  await act(async () => {
    pointer(handle, 'pointerdown', 20, 30);
    pointer(handle, 'pointermove', 900, 900);
    pointer(handle, 'pointerup', 900, 900);
    handle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  assert.equal(rail.style.left, '342px');
  assert.equal(rail.style.top, '292px');
  assert.equal(handle.getAttribute('aria-expanded'), 'true');
  await act(async () => handle.click());
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
});
test('a click still toggles and pointer cancellation never toggles the toolbar', async (t) => {
  const { handle } = await fixture(t);
  await act(async () => {
    pointer(handle, 'pointerdown', 20, 30);
    pointer(handle, 'pointerup', 20, 30);
    handle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
  await act(async () => {
    pointer(handle, 'pointerdown', 20, 30);
    pointer(handle, 'pointermove', 100, 100);
    pointer(handle, 'pointercancel', 100, 100);
    handle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
});
test('resizing the fullscreen viewport brings the toolbar back inside bounds', async (t) => {
  const { rail, handle, parent } = await fixture(t);
  await act(async () => {
    pointer(handle, 'pointerdown', 20, 30);
    pointer(handle, 'pointermove', 900, 900);
    pointer(handle, 'pointerup', 900, 900);
  });
  rail.getBoundingClientRect = () => ({
    left: Number.parseFloat(rail.style.left),
    top: Number.parseFloat(rail.style.top),
    width: 50,
    height: 200,
  });
  parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 });
  await act(async () => window.dispatchEvent(new window.Event('resize')));
  assert.equal(rail.style.left, '142px');
  assert.equal(rail.style.top, '92px');
  await act(async () => handle.click());
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
});
