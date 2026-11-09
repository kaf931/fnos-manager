import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const compiled = { exports: {} };
const built = await build({
  entryPoints: ['web/record-list.tsx'],
  write: false,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  plugins: [
    {
      name: 'pagination',
      setup(b) {
        b.onResolve({ filter: /task-pagination\.js$/ }, () => ({
          path: 'pagination',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const TaskPagination=()=>null;',
          loader: 'js',
        }));
      },
    },
  ],
});
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { RecordList } = compiled.exports;

for (const protectedRecord of [false, true])
  test(`mobile record list shares compact rows with selection first, protected=${protectedRecord}`, () => {
    const markup = renderToStaticMarkup(
      React.createElement(RecordList, {
        entries: [
          {
            id: 'a',
            title: '任务记录',
            status: 'success',
            statusLabel: '成功',
            meta: '2026/10/25',
            detail: '完整的结果说明',
            onOpen() {},
          },
        ],
        loading: false,
        empty: '暂无记录',
        selection: {
          selected: new Set(),
          eligible: new Set(protectedRecord ? [] : ['a']),
          busy: false,
          toggle() {},
          toggleAll() {},
        },
      }),
    );
    const document = new JSDOM(markup).window.document;
    const list = document.querySelector('.history-compact-list');
    assert.ok(list);
    const row = list.querySelector('.history-compact-row:not(.history-compact-select-all)');
    assert.equal(row.firstElementChild.type, 'checkbox');
    assert.equal(row.firstElementChild.disabled, protectedRecord);
    assert.match(row.querySelector('.history-compact-name').textContent, /任务记录/);
    assert.ok(row.querySelector('button[title*="完整的结果说明"]'));
    assert.equal(row.querySelector('button input'), null);
    assert.equal(
      list.querySelector('.history-compact-select-all').firstElementChild.type,
      'checkbox',
    );
  });

test('mobile refresh after deletion discards previously loaded page caches', async () => {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const browser = new JSDOM('<div id="root"></div>');
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  globalThis.window = browser.window;
  globalThis.document = browser.window.document;
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let model;
  let rows = Array.from({ length: 25 }, (_, index) => ({ id: String(index + 1) }));
  const api = async (url) => {
    const page = Number(new URL(url, 'http://test').searchParams.get('page'));
    return { items: rows.slice((page - 1) * 10, page * 10), total: rows.length };
  };
  function Probe() {
    model = compiled.exports.useRecordPage({ api, path: '/records', active: true, revision: 0 });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Probe)));
    await act(async () => model.loadMore());
    assert.equal(model.items.length, 20);
    rows = rows.filter((row) => row.id !== '1');
    await act(async () => model.refresh());
    assert.equal(model.page, 1);
    assert.deepEqual(
      model.items.map((row) => row.id),
      rows.slice(0, 10).map((row) => row.id),
    );
    await act(async () => model.loadMore());
    assert.deepEqual(
      model.items.map((row) => row.id),
      rows.slice(0, 20).map((row) => row.id),
    );
    // Another client removes records while this list still holds two cached pages.
    rows = rows.slice(0, 3);
    await act(async () => model.loadMore());
    assert.deepEqual(model.items, rows, 'shrinking totals discard pages beyond the last page');
    assert.equal(model.total, 3);
    assert.equal(model.page, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.window = old.window;
    globalThis.document = old.document;
    globalThis.matchMedia = old.matchMedia;
    globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
    browser.window.close();
  }
});
