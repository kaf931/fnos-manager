import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const built = await build({
  entryPoints: ['web/features/icons/page.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.png': 'dataurl' },
  plugins: [
    {
      name: 'ui-boundaries',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({ path: 'semi', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: 'export default function Pass(p){return p.children;}',
        }));
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
const { IconsPage } = module.exports;
const deferred = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve: (value) => resolve(value) };
};
const tick = () => act(async () => new Promise((r) => setImmediate(r)));
async function fixture(t, api) {
  const dom = new JSDOM('<main/>', {
    url: 'http://localhost/app/deskicons/',
    pretendToBeVisual: true,
  });
  const values = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    FileReader: dom.window.FileReader,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [k, value] of Object.entries(values))
    Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const root = createRoot(document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  await act(async () =>
    root.render(
      React.createElement(IconsPage, {
        active: true,
        services: { api, toast() {} },
        state: { native: true, gateway: false, hostname: 'nas' },
      }),
    ),
  );
  assert.ok(document.querySelector('.mobile-toolbar-filter[data-scroll-inset]'));
  return { root, dom };
}
const container = (id) => ({
  id,
  name: `Container ${id}`,
  image: 'image',
  state: 'running',
  ports: [],
  serviceUrl: `http://${id}.local`,
  iconUrl: '',
});
test('a previous React editor prefetch cannot replace a newer pending container load', async (t) => {
  const icon = deferred(),
    containers = deferred();
  let loads = 0;
  await fixture(t, async (route) => {
    if (route === '/entries') return [];
    if (route === '/containers') return ++loads === 1 ? [container('old')] : containers.promise;
    if (route === '/discover-icon') return icon.promise;
    throw Error(route);
  });
  await act(async () => document.querySelector('#add').click());
  await tick();
  assert.equal(loads, 1);
  await act(async () => document.querySelector('.dialog-close').click());
  await act(async () => document.querySelector('#add').click());
  await tick();
  assert.equal(loads, 2);
  assert.match(document.querySelector('#container-list').textContent, /正在读取 Docker 应用/);
  await act(async () => icon.resolve({ image: 'data:image/png;base64,eA==', source: 'found' }));
  await tick();
  assert.match(document.querySelector('#container-list').textContent, /正在读取 Docker 应用/);
  assert.equal(document.querySelector('[data-container="old"]'), null);
  await act(async () => containers.resolve([{ ...container('current'), serviceUrl: '' }]));
  await tick();
  assert.ok(document.querySelector('[data-container="current"]'));
  assert.equal(document.querySelector('[data-container="old"]'), null);
});
test('React icon preview prefetch keeps at most three workers and finishes every container', async (t) => {
  const pending = [];
  let active = 0,
    maximum = 0,
    requests = 0;
  await fixture(t, async (route) => {
    if (route === '/entries') return [];
    if (route === '/containers') return Array.from({ length: 7 }, (_, i) => container('item' + i));
    if (route === '/discover-icon') {
      requests++;
      active++;
      maximum = Math.max(maximum, active);
      const job = deferred();
      pending.push(() => {
        active--;
        job.resolve({ image: 'data:image/png;base64,eA==', source: 'found' });
      });
      return job.promise;
    }
    throw Error(route);
  });
  await act(async () => document.querySelector('#add').click());
  await tick();
  assert.equal(requests, 3);
  for (let i = 0; i < 7; i++) {
    assert.ok(pending[i]);
    await act(async () => pending[i]());
    await tick();
  }
  assert.equal(requests, 7);
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  assert.equal(document.querySelectorAll('#container-list .container-icon img').length, 7);
});

async function uploadFixture(t) {
  await fixture(t, async () => []);
  const readers = [];
  globalThis.FileReader = class {
    addEventListener(type, handler) {
      this['on' + type] = handler;
    }
    readAsDataURL() {
      readers.push(this);
    }
  };
  await act(() => document.querySelector('#add').click());
  const input = document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name: 'icon.png', type: 'image/png', size: 100 }],
  });
  await act(() => Simulate.change(input));
  return readers;
}

test('icon saving waits until the chosen local image is available', async (t) => {
  const readers = await uploadFixture(t);
  assert.equal(document.querySelector('#entry-form button[type=submit]').disabled, true);
  await act(() => {
    readers[0].result = 'data:image/png;base64,aWNvbg==';
    readers[0].onload();
  });
  assert.equal(
    document.querySelector('#icon-preview').getAttribute('src'),
    'data:image/png;base64,aWNvbg==',
  );
  assert.equal(document.querySelector('#entry-form button[type=submit]').disabled, false);
});

test('a local icon read failure unlocks saving and displays an actionable error', async (t) => {
  const readers = await uploadFixture(t);
  await act(() => readers[0].onerror?.());
  assert.match(document.querySelector('#entry-form').textContent, /图片读取失败/);
  assert.equal(document.querySelector('#entry-form button[type=submit]').disabled, false);
});
