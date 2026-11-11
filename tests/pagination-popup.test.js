import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const built = await build({
  entryPoints: ['web/task-pagination.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
});
for (const inDialog of [true, false])
  test(`pagination page-size popup stays in ${inDialog ? 'its native dialog' : 'the page'} and remains selectable`, async (t) => {
    const dom = new JSDOM(inDialog ? '<dialog open><main/></dialog>' : '<main/>', {
      pretendToBeVisual: true,
      url: 'http://localhost',
    });
    const values = {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = {};
    for (const [k, v] of Object.entries(values)) {
      previous[k] = Object.getOwnPropertyDescriptor(globalThis, k);
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    }
    const compiled = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(
      createRequire(import.meta.url),
      compiled,
      compiled.exports,
    );
    const root = createRoot(document.querySelector('main'));
    t.after(async () => {
      await act(() => root.unmount());
      dom.window.close();
      for (const [k, v] of Object.entries(previous))
        if (v) Object.defineProperty(globalThis, k, v);
        else delete globalThis[k];
    });
    let change;
    await act(() =>
      root.render(
        React.createElement(compiled.exports.TaskPagination, {
          page: 1,
          pageSize: 10,
          total: 100,
          onChange: (...args) => (change = args),
        }),
      ),
    );
    await act(async () => {
      document
        .querySelector('.semi-select')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });
    const list = document.querySelector('.semi-page-select-dropdown');
    assert.ok(list);
    assert.equal(!!list.closest('dialog'), inDialog);
    const option = [...list.querySelectorAll('.semi-select-option')].find((e) =>
      e.textContent.includes('20'),
    );
    await act(() => option.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(change, [1, 20]);
  });
