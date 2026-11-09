import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
const compiled = { exports: {} };
const built = await build({
  entryPoints: ['web/maintenance-records.tsx'],
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
const { MaintenanceRecordRows, maintenanceRecordModes } = compiled.exports;
test('remaining cleanup categories use public record destinations and escape log names', () => {
  assert.deepEqual(Object.values(maintenanceRecordModes), [
    'taskRuns',
    'restoreReceipts',
    'serviceLog',
    'updateCache',
    'aiHistory',
  ]);
  const doc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(
        'table',
        null,
        React.createElement(
          'tbody',
          null,
          React.createElement(MaintenanceRecordRows, {
            items: [
              {
                id: 'a',
                name: '<img src=x onerror=alert(1)>',
                status: 'failed',
                createdAt: '2026-10-24T00:00:00Z',
                summary: '退出码 1',
                bytes: null,
              },
            ],
            onOpen: () => {},
          }),
        ),
      ),
    ),
  ).window.document;
  assert.equal(doc.querySelector('img'), null);
  assert.equal(doc.querySelector('button').textContent, '<img src=x onerror=alert(1)>');
  assert.ok(doc.querySelector('.state-badge.failed'));
  assert.ok(doc.body.textContent.includes('2026'));
});

test('maintenance record table places select-all and row selection in the first column', async (t) => {
  const { act } = await import('react');
  const { recordFixture } = await import('./helpers/react-storage-harness.js');
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const previous = {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    matchMedia: () => ({ matches: false }),
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
  await act(async () => {
    manager = recordFixture(compiled.exports.MaintenanceRecords, {
      host: document.querySelector('main'),
      kind: 'taskRuns',
      api: async () => ({
        items: [
          {
            id: 'a',
            name: '任务记录',
            status: 'success',
            createdAt: '2026-10-24T00:00:00Z',
            summary: '完成',
            bytes: null,
          },
        ],
        total: 1,
      }),
    });
    manager.setActive(true);
  });
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
  assert.equal(table.querySelector('tbody tr').children[1].textContent, '任务记录');
});
