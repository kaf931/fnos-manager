import { recordFixture } from './helpers/react-storage-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act } from 'react';
const built = await build({
  entryPoints: ['web/notification-records.tsx'],
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
const { NotificationRecords } = module.exports;
const tick = () => new Promise((r) => setTimeout(r, 10));
test('delivery records load in the storage page, stop while hidden and ignore late responses', async (t) => {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const values = {
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
  let late;
  const calls = [];
  let deferred = false;
  const item = {
    id: 'one',
    name: '通知测试',
    status: 'success',
    attempts: 1,
    createdAt: '2026-10-24T00:00:00Z',
    httpStatus: 200,
    error: '',
  };
  const manager = recordFixture(NotificationRecords, {
    host: document.querySelector('main'),
    api: async (route, method, body) => {
      calls.push({ route, method, body });
      if (deferred) {
        deferred = false;
        return new Promise((r) => {
          late = r;
        });
      }
      return { items: [item], total: 1, page: 1, pageSize: 10 };
    },
  });
  t.after(async () => {
    await act(async () => manager.dispose());
    dom.window.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  await act(async () => {
    manager.setActive(true);
    await tick();
  });
  assert.match(document.body.textContent, /通知测试/);
  const table = document.querySelector('.record-table');
  assert.ok(table.querySelector('colgroup').firstElementChild.classList.contains('col-selection'));
  assert.equal(
    table.querySelector('thead tr').firstElementChild.querySelector('input').type,
    'checkbox',
  );
  assert.equal(
    table.querySelector('tbody tr').firstElementChild.querySelector('input').type,
    'checkbox',
  );
  assert.match(document.body.textContent, /HTTP 200/);
  assert.equal(document.querySelector('dialog'), null);
  assert.ok(document.querySelector('main section[aria-label="投递记录列表"]'));
  assert.ok(calls.every((c) => c.route.startsWith('/notifications/deliveries?page=')));
  deferred = true;
  await act(async () => {
    manager.refresh();
    await tick();
  });
  await act(async () => {
    manager.setActive(false);
    await tick();
  });
  await act(async () => {
    late({ items: [{ ...item, name: '过期响应' }], total: 1, page: 1, pageSize: 10 });
    await tick();
  });
  assert.doesNotMatch(document.body.textContent, /过期响应/);
  await act(async () => {
    manager.setActive(true);
    await tick();
  });
  assert.match(document.body.textContent, /通知测试/);
});

test('mobile record lists append unique cards, retry the failed page and omit desktop pagination', async (t) => {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const previous = {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  let manager;
  t.after(async () => {
    if (manager) await act(async () => manager.dispose());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  const calls = [];
  let failSecond = true;
  const row = (id) => ({
    id: String(id),
    name: '通知 ' + id,
    status: 'success',
    attempts: 1,
    createdAt: '2026-10-24T00:00:00Z',
    httpStatus: 200,
    error: '',
  });
  await act(async () => {
    manager = recordFixture(NotificationRecords, {
      host: document.querySelector('main'),
      api: async (path) => {
        const page = Number(new URL(path, 'http://fixture').searchParams.get('page'));
        calls.push(page);
        if (page === 2 && failSecond) {
          failSecond = false;
          throw new Error('网络暂时失败');
        }
        return {
          items:
            page === 3
              ? [row(0), row(20)]
              : Array.from({ length: 10 }, (_, i) => row((page - 1) * 10 + i)),
          total: 21,
        };
      },
    });
    manager.setActive(true);
    await tick();
  });
  const cards = () =>
    document.querySelectorAll('.history-compact-row:not(.history-compact-select-all)').length;
  const more = () =>
    [...document.querySelectorAll('button')].find((b) => /加载更多|重试加载/.test(b.textContent));
  assert.equal(cards(), 10);
  assert.equal(document.querySelector('.native-pagination'), null);
  await act(async () => {
    more().click();
    await tick();
  });
  assert.equal(cards(), 10);
  assert.match(more().textContent, /重试/);
  await act(async () => {
    more().click();
    await tick();
  });
  assert.equal(cards(), 20);
  await act(async () => {
    more().click();
    await tick();
  });
  assert.equal(cards(), 21);
  assert.equal(more(), undefined);
  assert.deepEqual(calls, [1, 2, 2, 3]);
  await act(async () => {
    manager.setActive(false);
    await tick();
  });
  await act(async () => {
    manager.setActive(true);
    await tick();
  });
  assert.equal(cards(), 10);
  assert.equal(calls.at(-1), 1);
});
