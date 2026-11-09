import { recordFixture } from './helpers/react-storage-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act } from 'react';
const built = await build({
  entryPoints: ['web/operation-records.tsx'],
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
const { OperationRecords } = module.exports;
const tick = () => new Promise((r) => setTimeout(r, 10));
test('operation records filter server results without a settings footer and ignore stale pages', async (t) => {
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
    ownerUid: '1000',
    action: 'ssh.rename',
    target: 'sample.txt',
    status: 'success',
    startedAt: '2026-10-23T00:00:00.000Z',
    finishedAt: '2026-10-23T00:00:01.000Z',
    summary: '操作完成',
  };
  const manager = recordFixture(OperationRecords, {
    host: document.querySelector('main'),
    api: async (route, method, body) => {
      calls.push({ route, method, body });
      if (route === '/operations/settings') return method === 'PUT' ? body : { retention: 1000 };
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
  assert.match(document.body.textContent, /sample.txt/);
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
  const select = (label) => document.querySelector('select[aria-label="' + label + '"]');
  assert.equal(select('保留上限'), null);
  assert.equal(document.querySelector('.dialog-footer'), null);
  assert.equal(document.querySelector('dialog'), null);
  assert.ok(document.querySelector('main section[aria-label="操作记录列表"]'));
  assert.equal(
    calls.some((c) => c.route === '/operations/settings'),
    false,
  );
  deferred = true;
  await act(async () => {
    select('操作类型').value = 'ssh.delete';
    select('操作类型').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick();
  });
  await act(async () => {
    select('操作类型').value = 'ssh.rename';
    select('操作类型').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick();
  });
  await act(async () => {
    late({ items: [{ ...item, target: 'stale' }], total: 1, page: 1, pageSize: 10 });
    await tick();
  });
  assert.doesNotMatch(document.body.textContent, /stale/);
  assert.ok(calls.some((c) => c.route.includes('action=ssh.delete')));
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
    late({ items: [{ ...item, target: 'hidden response' }], total: 1, page: 1, pageSize: 10 });
    await tick();
  });
  assert.doesNotMatch(document.body.textContent, /hidden response/);
  await act(async () => {
    manager.setActive(true);
    await tick();
  });
  assert.match(document.body.textContent, /sample.txt/);
});
