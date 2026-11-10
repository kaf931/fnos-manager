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
      "export {NativeSelect} from './web/native-select.tsx';export {selectBridge} from '@douyinfe/semi-ui/lib/es/select';",
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
        b.onResolve({ filter: /@douyinfe\/semi-ui\/lib\/es\/select$/ }, () => ({
          path: 'select',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `import React from 'react';export const selectBridge={};export default function Select(props){selectBridge.props=props;return <button id={props.id} onClick={()=>props.onDropdownVisibleChange?.(true)}>选择</button>;}`,
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
const { NativeSelect, selectBridge } = compiled.exports;
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
      React.createElement(NativeSelect, { id: 'repeat', value: 'none', optionList: [], ...props }),
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
test('select stays below its trigger and shrinks to the clipping dialog space', async (t) => {
  let notified = false;
  const p = await fixture(
    t,
    { top: 410, bottom: 442 },
    { top: 80, bottom: 640 },
    { onDropdownVisibleChange: (v) => (notified = v) },
  );
  assert.equal(p.position, 'bottomLeft');
  assert.equal(p.autoAdjustOverflow, false);
  assert.equal(p.dropdownStyle.maxHeight, 190);
  assert.equal(notified, true);
});
test('short dialog bounds cap popup height without changing its downward direction', async (t) => {
  const p = await fixture(t, { top: 180, bottom: 212 }, { top: 100, bottom: 320 });
  assert.equal(p.position, 'bottomLeft');
  assert.ok(p.dropdownStyle.maxHeight <= 100);
  assert.ok(p.dropdownStyle.maxHeight > 0);
});
