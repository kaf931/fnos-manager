import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
export const tick = () => new Promise((r) => setImmediate(r));
export async function mountUi(t, entry, name, props, stubs = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }),
    previous = {
      window: globalThis.window,
      document: globalThis.document,
      HTMLElement: globalThis.HTMLElement,
      Element: globalThis.Element,
      matchMedia: globalThis.matchMedia,
      CustomEvent: globalThis.CustomEvent,
      Event: globalThis.Event,
    };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    matchMedia: () => ({ matches: false }),
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../web/' + entry + '.tsx', import.meta.url))],
    loader: { '.jpg': 'dataurl' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'controls',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            const entry = Object.keys(stubs).find(
              (suffix) => args.path === suffix || args.path.endsWith(suffix + '.js'),
            );
            if (entry) return { path: entry, namespace: 'test-stub' };
          });
          b.onLoad({ filter: /.*/, namespace: 'test-stub' }, (args) => ({
            loader: 'js',
            contents: stubs[args.path],
          }));
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
          b.onResolve({ filter: /progress-control\.js$/ }, () => ({
            path: 'progress',
            namespace: 'progress-stub',
          }));
          b.onLoad({ filter: /.*/, namespace: 'progress-stub' }, () => ({
            loader: 'js',
            contents: `import React from 'react'; export function ProgressControl(p){return React.createElement('progress',{'aria-label':p.label,value:p.percent,max:100})}`,
          }));
          b.onResolve({ filter: /native-select\.js$/ }, () => ({
            path: 'select',
            namespace: 'stub',
          }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            loader: 'js',
            contents: `import React, { act } from 'react'; export function NativeSelect(p){return React.createElement('select',{'aria-labelledby':p['aria-labelledby'],value:p.value,disabled:p.disabled,onChange:e=>p.onChange(e.target.value)},p.optionList.map(o=>React.createElement('option',{key:o.value,value:o.value,disabled:o.disabled},o.label)))}`,
          }));
        },
      },
    ],
  });
  const path = new URL(
    `../../.web-test/react-${process.pid}-${Math.random()}.mjs`,
    import.meta.url,
  );
  await writeFile(path, result.outputFiles[0].text);
  const module = await import(path.href);
  await unlink(path);
  const root = createRoot(globalThis.document.querySelector('#root'));
  let mounted = true;
  const close = () => {
    if (mounted) {
      flushSync(() => root.render(null));
      mounted = false;
    }
  };
  await act(async () => {
    root.render(React.createElement(module[name], { ...props, onClose: close }));
  });
  t.after(() => {
    flushSync(() => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  await tick();
  return {
    close,
    click(selector) {
      flushSync(() => globalThis.document.querySelector(selector).click());
    },
    get: (selector) => globalThis.document.querySelector(selector),
  };
}
