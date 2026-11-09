import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    matchMedia: () => ({ matches: false }),
  };
  const previous = Object.fromEntries(
    Object.keys(replacements).map((key) => [key, globalThis[key]]),
  );
  Object.assign(globalThis, replacements);
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  let root, page;
  t.after(() => {
    if (root) flushSync(() => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  });
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../web/features/wake/page.tsx', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'themed-controls-boundary',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
          b.onResolve({ filter: /native-select\.js$/ }, () => ({
            path: 'select',
            namespace: 'stub',
          }));
          b.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({
            path: 'semi',
            namespace: 'stub',
          }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            loader: 'js',
            contents:
              path === 'select'
                ? `import React from 'react'; export function NativeSelect({optionList, onChange, ...props}) { return React.createElement('select', {...props, onChange:e=>onChange(e.target.value)}, optionList.map(o=>React.createElement('option',{key:o.value,value:o.value,disabled:o.disabled},o.label))) }`
                : 'function Stub(){return null}; Stub.Menu=Stub; Stub.Item=Stub; export default Stub',
          }));
        },
      },
    ],
  });
  const path = new URL(
    `../.web-test/wake-page-${process.pid}-${Math.random()}.mjs`,
    import.meta.url,
  );
  await writeFile(path, result.outputFiles[0].text);
  const { WakePage } = await import(path.href);
  await unlink(path);
  const pending = [],
    writes = [],
    saves = [],
    messages = [];
  const rows = [
    {
      id: 'wake-only',
      name: 'Wake only',
      mac: '02:11:22:33:44:55',
      address: '192.168.1.255',
      port: 9,
    },
    {
      id: 'ssh-device',
      name: 'SSH device',
      mac: '02:11:22:33:44:56',
      address: '192.168.1.255',
      port: 9,
      connectionId: 'ssh',
    },
  ];
  root = createRoot(document.querySelector('#root'));
  flushSync(() =>
    root.render(
      (page = React.createElement(WakePage, {
        active: true,
        services: {
          toast: (m) => messages.push(m),
          api: async (route, method, body) => {
            if (route === '/terminal/connections')
              return new Promise((resolve, reject) => pending.push({ resolve, reject }));
            if (route === '/wake/devices' && method === 'POST') {
              writes.push(body);
              return new Promise((resolve, reject) => saves.push({ resolve, reject }));
            }
            if (route === '/wake/devices' || route === '/wake/check') return rows;
            throw Error(route);
          },
        },
      })),
    ),
  );
  await tick();
  await tick();
  const get = (selector) => document.querySelector(selector);
  const open = async () => {
    get('#wake-add').click();
    await tick();
  };
  return {
    get,
    open,
    pending,
    writes,
    saves,
    messages,
    async setActive(active) {
      flushSync(() => root.render(React.cloneElement(page, { active })));
      await tick();
    },
  };
}
test('wake toolbar restores shared icons, desktop select and matching mobile filters', async (t) => {
  const ui = await setup(t);
  assert.ok(ui.get('#wake-kind-filter .mobile-toolbar-filter[data-scroll-inset]'));
  const filters = [
    ...ui.get('#wake-kind-filter .mobile-toolbar-filter').querySelectorAll('button'),
  ];
  filters[1].click();
  await tick();
  assert.equal(ui.get('#wake-kind-filter select').value, 'ssh');
  assert.equal(filters[1].getAttribute('aria-pressed'), 'true');
  assert.match(ui.get('#wake-cards').textContent, /SSH device/);
  assert.doesNotMatch(ui.get('#wake-cards').textContent, /Wake only/);
  for (const id of ['wake-discover', 'wake-manage', 'wake-add', 'wake-reload']) {
    assert.ok(ui.get('#' + id + ' svg'));
    assert.ok(ui.get('#' + id).getAttribute('aria-label'));
  }
  assert.ok(ui.get('#wake-reload.toolbar-refresh'));
  assert.ok(ui.get('#wake-cards[data-scroll-inset]'));
});
test('reopened wake editor ignores previous SSH responses and saves once while close is blocked', async (t) => {
  const ui = await setup(t);
  await ui.open();
  ui.get('#wake-editor .dialog-close').click();
  await tick();
  await ui.open();
  ui.pending[0].resolve([{ id: 'old', kind: 'remote', name: 'Old', hasCredentials: true }]);
  await tick();
  assert.equal(ui.get('#wake-save').disabled, true);
  ui.pending[1].resolve([{ id: 'ssh', kind: 'remote', name: 'Current', hasCredentials: true }]);
  await tick();
  assert.equal(ui.get('#wake-save').disabled, false);
  assert.doesNotMatch(ui.get('#wake-connection').textContent, /Old/);
  assert.match(ui.get('#wake-connection').textContent, /Current/);
  ui.get('#wake-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  ui.get('#wake-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(ui.writes.length, 1);
  ui.get('#wake-editor .dialog-close').click();
  await tick();
  assert.ok(ui.get('#wake-editor'));
  ui.saves[0].resolve({});
  await tick();
  assert.equal(ui.get('#wake-editor'), null);
  assert.ok(ui.messages.includes('设备已保存'));
});

test('batch management prevents duplicate loads and recovers after failure', async (t) => {
  const ui = await setup(t);
  const manage = ui.get('#wake-manage');
  manage.click();
  await tick();
  assert.equal(manage.disabled, true);
  manage.click();
  await tick();
  assert.equal(ui.pending.length, 1);
  ui.pending[0].reject(Error('connection list unavailable'));
  await tick();
  assert.equal(manage.disabled, false);
  assert.ok(ui.messages.includes('connection list unavailable'));
  manage.click();
  await tick();
  ui.pending[1].resolve([]);
  await tick();
  assert.ok(ui.get('#wake-batch-dialog'));
});

test('leaving wake page invalidates a pending batch dialog request', async (t) => {
  const ui = await setup(t);
  ui.get('#wake-manage').click();
  await tick();
  await ui.setActive(false);
  await ui.setActive(true);
  ui.get('#wake-manage').click();
  await tick();
  assert.equal(ui.pending.length, 2);
  ui.pending[0].resolve([]);
  await tick();
  assert.equal(ui.get('#wake-batch-dialog'), null);
  assert.equal(ui.get('#wake-manage').disabled, true);
  ui.pending[1].resolve([]);
  await tick();
  assert.ok(ui.get('#wake-batch-dialog'));
});
