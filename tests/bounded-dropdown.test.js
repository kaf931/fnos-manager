import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const out = await build({
  stdin: {
    contents:
      "export {BoundedDropdown} from './web/ui/bounded-dropdown.tsx';export {selectBridge} from '@douyinfe/semi-ui/lib/es/dropdown';",
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  plugins: [
    {
      name: 'semi',
      setup(b) {
        b.onResolve({ filter: /@douyinfe\/semi-ui\/lib\/es\/dropdown$/ }, () => ({
          path: 'select',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `import React from 'react';export const selectBridge={};export default function Dropdown(props){selectBridge.props=props;return React.cloneElement(props.children,{onClick:()=>props.onVisibleChange?.(!props.visible)});}`,
          loader: 'jsx',
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', out.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { BoundedDropdown, selectBridge } = compiled.exports;
async function fixture(t, { top, bottom }, bounds, props = {}) {
  const dom = new JSDOM('<dialog open><main/></dialog>', { pretendToBeVisual: true });
  const saved = {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  Object.defineProperty(dom.window, 'innerHeight', { value: 720, configurable: true });
  selectBridge.closed = 0;
  const root = createRoot(document.querySelector('main'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(saved))
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  await act(() =>
    root.render(
      React.createElement(
        BoundedDropdown,
        { position: 'bottomRight', ...props },
        React.createElement('button', { id: 'repeat' }, '更多'),
      ),
    ),
  );
  document.querySelector('#repeat').getBoundingClientRect = () => ({
    top,
    bottom,
    left: 100,
    right: 300,
    width: 200,
    height: bottom - top,
  });
  document.querySelector('dialog').getBoundingClientRect = () => ({
    ...bounds,
    left: 50,
    right: 650,
    width: 600,
    height: bounds.bottom - bounds.top,
  });
  await act(() => document.querySelector('#repeat').click());
  return selectBridge.props;
}
test('operation menu stays downward and fits the dialog instead of the window', async (t) => {
  await fixture(t, { top: 410, bottom: 442 }, { top: 80, bottom: 565 });
  assert.equal(selectBridge.props.visible, true);
  assert.equal(selectBridge.props.position, 'bottomRight');
  assert.equal(selectBridge.props.autoAdjustOverflow, false);
  assert.equal(selectBridge.props.style.maxHeight, 115);
});
test('open operation menu updates bounds and closes when its trigger leaves view', async (t) => {
  await fixture(t, { top: 410, bottom: 442 }, { top: 80, bottom: 565 });
  document.querySelector('dialog').getBoundingClientRect = () => ({ top: 80, bottom: 520 });
  await act(() => window.dispatchEvent(new window.Event('resize')));
  assert.equal(selectBridge.props.style.maxHeight, 70);
  document.querySelector('dialog').getBoundingClientRect = () => ({ top: 80, bottom: 430 });
  await act(() => window.dispatchEvent(new window.Event('scroll')));
  assert.equal(selectBridge.props.visible, false);
});
test('controlled menu reports dismissal when the anchor becomes clipped', async (t) => {
  const changes = [];
  await fixture(
    t,
    { top: 410, bottom: 442 },
    { top: 80, bottom: 565 },
    { visible: true, onVisibleChange: (v) => changes.push(v) },
  );
  document.querySelector('main').style.overflowY = 'auto';
  document.querySelector('main').getBoundingClientRect = () => ({ top: 80, bottom: 400 });
  await act(() => window.dispatchEvent(new window.Event('scroll')));
  assert.equal(changes.at(-1), false);
});

test('Escape dismisses the operation menu without invoking the native dialog cancel action', async (t) => {
  let forwarded = null;
  const props = await fixture(
    t,
    { top: 410, bottom: 442 },
    { top: 80, bottom: 565 },
    {
      onEscKeyDown: (event) => {
        forwarded = event;
      },
    },
  );
  const event = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  props.onEscKeyDown(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(forwarded, event);
});

test('Escape is not consumed after the operation menu has closed', async (t) => {
  await fixture(t, { top: 410, bottom: 442 }, { top: 80, bottom: 565 });
  await act(() => selectBridge.props.onVisibleChange(false));
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  selectBridge.props.onEscKeyDown(event);
  assert.equal(event.defaultPrevented, false);
});

test('a closed trigger lets Escape reach the browser without Semi intercepting it', async (t) => {
  await fixture(t, { top: 410, bottom: 442 }, { top: 80, bottom: 565 });
  await act(() => selectBridge.props.onVisibleChange(false));
  let bubbled = false;
  document.querySelector('main').addEventListener('keydown', () => {
    bubbled = true;
  });
  const event = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  await act(() => document.querySelector('#repeat').dispatchEvent(event));
  assert.equal(bubbled, false);
  assert.equal(event.defaultPrevented, false);
});

test('side-aligned menus fit above their bottom anchor, including the configured vertical offset', async (t) => {
  await fixture(
    t,
    { top: 300, bottom: 332 },
    { top: 80, bottom: 640 },
    { position: 'rightBottom', spacing: { x: 20, y: 20 } },
  );
  assert.equal(selectBridge.props.style.maxHeight, 268);
});

test('a side menu closes when its offset alignment edge leaves the visible bounds', async (t) => {
  await fixture(
    t,
    { top: 580, bottom: 612 },
    { top: 80, bottom: 640 },
    { position: 'rightBottom', spacing: { x: 20, y: 50 } },
  );
  assert.equal(selectBridge.props.visible, false);
});

test('side menu height respects the public outer-surface viewport inset after resize', async (t) => {
  await fixture(
    t,
    { top: 380, bottom: 408 },
    { top: 0, bottom: 640 },
    { position: 'rightBottom', spacing: { x: 8, y: 4 } },
  );
  Object.defineProperty(window, 'innerHeight', { value: 420, configurable: true });
  await act(() => window.dispatchEvent(new window.Event('resize')));
  assert.equal(selectBridge.props.style.maxHeight, 388);
});
