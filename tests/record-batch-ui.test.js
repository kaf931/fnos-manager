import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const built = await build({
  stdin: {
    contents:
      "export * from './web/record-batch.tsx'; export {ConfirmationHost} from './web/confirmation.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const {
  ConfirmationHost,
  RecordBatchControl,
  useRecordBatch,
  RecordSelectAll,
  RecordSelect,
  canSelectRecord,
} = compiled.exports;
const tick = () => new Promise((r) => setTimeout(r, 5));
async function setup(t, records, respond = async () => ({ deleted: 1 })) {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const previous = {};
  for (const [key, value] of Object.entries({
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const root = createRoot(document.querySelector('main')),
    reports = [],
    control = new RecordBatchControl(
      () => {},
      (message) => reports.push(message),
    ),
    calls = [];
  let refreshes = 0;
  const api = async (...args) => {
    calls.push(args);
    return respond(...args);
  };
  const items = records ?? [
    { id: 'done', status: 'success' },
    { id: 'active', status: 'running' },
  ];
  function Harness({ scope = 'first', active = true }) {
    const selection = useRecordBatch({
      api,
      kind: 'operations',
      items,
      active,
      scope,
      control,
      refresh: () => refreshes++,
    });
    return React.createElement(
      'div',
      null,
      React.createElement(ConfirmationHost),
      React.createElement(RecordSelectAll, { selection }),
      ...items.map((row) =>
        React.createElement(RecordSelect, { key: row.id, selection, id: row.id, name: row.id }),
      ),
    );
  }
  t.after(async () => {
    await act(async () => {
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      root.unmount();
      await tick();
    });
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(async () => {
    root.render(React.createElement(Harness));
    await tick();
  });
  return { dom, root, Harness, control, calls, reports, refreshes: () => refreshes };
}
test('batch selection skips active records and submits only selected IDs after confirmation', async (t) => {
  const f = await setup(t);
  assert.equal(document.querySelector('[aria-label="选择 active"]').disabled, true);
  await act(async () => {
    document.querySelector('[aria-label="选择本页可清理记录"]').click();
    await tick();
  });
  assert.equal(f.control.selectionCount(), 1);
  let pending;
  await act(async () => {
    pending = f.control.manage();
    await tick();
  });
  assert.equal(f.calls.length, 0);
  await act(async () => {
    [...document.querySelectorAll('dialog button')]
      .find((b) => b.textContent === '删除记录')
      .click();
    await tick();
  });
  await pending;
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].slice(0, 3), [
    '/storage/cleanup/records/operations/delete',
    'POST',
    { ids: ['done'], confirmed: true },
  ]);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.control.selectionCount(), 0);
});
test('changing record scope invalidates a pending batch confirmation', async (t) => {
  const f = await setup(t);
  await act(async () => {
    document.querySelector('[aria-label="选择 done"]').click();
    await tick();
  });
  let pending;
  await act(async () => {
    pending = f.control.manage();
    await tick();
  });
  await act(async () => {
    f.root.render(React.createElement(f.Harness, { scope: 'other' }));
    await tick();
  });
  await act(async () => {
    [...document.querySelectorAll('dialog button')]
      .find((b) => b.textContent === '删除记录')
      .click();
    await tick();
  });
  assert.equal(f.calls.length, 0);
  assert.match(document.querySelector('dialog [role="alert"]').textContent, /已变化/);
  await act(async () => {
    [...document.querySelectorAll('dialog button')].find((b) => b.textContent === '取消').click();
    await tick();
  });
  await pending;
});
test('shared record selection protects running, queued, sending and in-use records', () => {
  for (const status of ['running', 'pending', 'sending', 'protected', 'in-use'])
    assert.equal(canSelectRecord({ status }), false);
  for (const status of ['success', 'failed', 'cancelled', 'partial', 'interrupted', 'available'])
    assert.equal(canSelectRecord({ status }), true);
});

test('201+ eligible records cap selection, preserve protected rows and can deselect the capped page', async (t) => {
  const f = await setup(t, [
    ...Array.from({ length: 205 }, (_, i) => ({ id: `row-${i}`, status: 'success' })),
    { id: 'protected', status: 'running' },
  ]);
  const all = document.querySelector('[aria-label="选择本页可清理记录"]');
  await act(() => all.click());
  assert.equal(f.control.selectionCount(), 200);
  assert.equal(all.checked, true);
  assert.match(f.reports.at(-1), /最多选择 200/);
  assert.equal(document.querySelector('[aria-label="选择 protected"]').disabled, true);
  await act(() => document.querySelector('[aria-label="选择 row-200"]').click());
  assert.equal(f.control.selectionCount(), 200);
  assert.equal(document.querySelector('[aria-label="选择 row-200"]').checked, false);
  await act(() => document.querySelector('[aria-label="选择 row-0"]').click());
  assert.equal(all.checked, false);
  await act(() => document.querySelector('[aria-label="选择 row-200"]').click());
  assert.equal(f.control.selectionCount(), 200);
  assert.equal(all.checked, true);
  await act(() => all.click());
  assert.equal(f.control.selectionCount(), 0);
  await act(() => all.click());
  let pending;
  await act(async () => {
    pending = f.control.manage();
    await tick();
  });
  await act(async () => {
    [...document.querySelectorAll('dialog button')]
      .find((b) => b.textContent === '删除记录')
      .click();
    await tick();
  });
  await pending;
  assert.equal(f.calls[0][2].ids.length, 200);
  assert.equal(f.calls[0][2].ids.includes('protected'), false);
});

test('batch completion while hidden releases controls when the records page returns', async (t) => {
  let finish;
  const f = await setup(
    t,
    undefined,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(() => document.querySelector('[aria-label="选择 done"]').click());
  let pending;
  await act(async () => {
    pending = f.control.manage();
    await tick();
  });
  await act(async () => {
    [...document.querySelectorAll('dialog button')]
      .find((b) => b.textContent === '删除记录')
      .click();
    await tick();
  });
  assert.equal(document.querySelector('[aria-label="选择 done"]').disabled, true);
  await act(() => f.root.render(React.createElement(f.Harness, { active: false })));
  await act(async () => {
    finish({ deleted: 1 });
    await pending;
  });
  await act(() => f.root.render(React.createElement(f.Harness, { active: true })));
  assert.equal(document.querySelector('[aria-label="选择 done"]').disabled, false);
  await act(() => document.querySelector('[aria-label="选择 done"]').click());
  assert.equal(f.control.selectionCount(), 1);
});
