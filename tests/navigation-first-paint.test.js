import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const built = await build({
  entryPoints: ['web/app-shell.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'page-boundaries',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve(
          { filter: /features\/(icons|tasks|storage|wake|terminal)\/page\.js$/ },
          (a) => ({ path: a.path, namespace: 'page' }),
        );
        b.onResolve({ filter: /system-settings\.js$/ }, () => ({
          path: 'settings',
          namespace: 'page',
        }));
        b.onResolve({ filter: /\/notifications\.js$/ }, () => ({
          path: 'notifications',
          namespace: 'page',
        }));
        b.onLoad({ filter: /.*/, namespace: 'page' }, ({ path }) => {
          const name =
              path === 'settings' || path === 'notifications'
                ? path
                : path.match(/features\/(\w+)\//)[1],
            symbol = {
              icons: 'IconsPage',
              tasks: 'TasksPage',
              storage: 'StoragePage',
              wake: 'WakePage',
              terminal: 'RemoteConnectionPage',
              settings: 'SettingsPage',
              notifications: 'NotificationSettingsPage',
            }[name];
          return {
            loader: 'js',
            contents: `import React from 'react';export function ${symbol}({active}){return React.createElement('section',{id:'${name}-page',className:'tool-page',hidden:!active})}`,
          };
        });
        b.onResolve(
          {
            filter:
              /\/(platform|mobile-navigation|shared-scrollbars|preferences|mobile-navigation-more|confirmation)\.js$/,
          },
          (a) => ({ path: a.path.split('/').pop().slice(0, -3), namespace: 'infra' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'infra' }, ({ path }) => ({
          loader: 'js',
          contents: {
            platform: 'export async function initPlatform(){}',
            'mobile-navigation': 'export const setupMobileNavigation=()=>()=>{};',
            'shared-scrollbars': 'export const setupSharedScrollbars=()=>()=>{};',
            preferences:
              "export const getPreferences=()=>({defaultPage:'icons',navigationMotion:true}); export const subscribePreferences=()=>()=>{};export async function loadPreferences(){};",
            'mobile-navigation-more': 'export function MobileMore(){return null}',
            confirmation: 'export function ConfirmationHost(){return null}',
          }[path],
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
const { App } = module.exports;
const tick = () => new Promise((r) => setImmediate(r));
async function app(t, search) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' + search }),
    keys = ['window', 'document', 'location', 'CustomEvent', 'fetch'],
    previous = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  let ready, fail;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    CustomEvent: dom.window.CustomEvent,
    fetch: () =>
      new Promise((resolve, reject) => {
        fail = () => reject(new Error('无法连接服务'));
        ready = () =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({
              native: false,
              gateway: false,
              csrfToken: 'token',
              version: '0.3.1',
              hostname: 'NAS',
            }),
          });
      }),
  });
  const root = createRoot(document.querySelector('#app'));
  flushSync(() => root.render(React.createElement(App)));
  t.after(() => {
    flushSync(() => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  return {
    ready: async () => {
      ready();
      await tick();
      await tick();
    },
    fail: async () => {
      fail();
      await tick();
      await tick();
    },
    doc: document,
  };
}
test('entry document has one empty React mount and no competing navigation before JavaScript', async () => {
  const dom = new JSDOM(await readFile('web/index.html', 'utf8'));
  try {
    const doc = dom.window.document;
    assert.ok(doc.querySelector('#app'));
    assert.equal(doc.querySelector('#app').children.length, 0);
    assert.equal(doc.querySelector('.sidebar'), null);
    assert.equal(doc.querySelectorAll('script[type="module"]').length, 1);
  } finally {
    dom.window.close();
  }
});
test('actual App first paint hides standalone navigation and keeps requested page after bootstrap', async (t) => {
  const { doc, ready } = await app(t, '?page=terminal&standalone=1');
  assert.equal(doc.querySelector('.sidebar').hidden, true);
  assert.equal(doc.querySelector('[aria-current=page]').dataset.page, 'terminal');
  for (const b of doc.querySelectorAll('.sidebar .nav-item[data-page]'))
    assert.equal(b.querySelectorAll('svg.nav-symbol').length, 1, b.dataset.page);
  assert.equal(doc.querySelectorAll('#settings-open svg').length, 1);
  assert.equal(doc.querySelectorAll('.tool-page').length, 0);
  await ready();
  assert.deepEqual(
    [...doc.querySelectorAll('.tool-page:not([hidden])')].map((e) => e.id),
    ['terminal-page'],
  );
});
test('actual App navigation switches active pages without unmounting their React trees', async (t) => {
  const { doc, ready } = await app(t, '');
  await ready();
  const terminal = doc.querySelector('#terminal-page');
  flushSync(() => doc.querySelector('[data-page=terminal]').click());
  assert.equal(terminal.hidden, false);
  assert.equal(doc.querySelector('#icons-page').hidden, true);
  flushSync(() => doc.querySelector('[data-page=wake]').click());
  assert.equal(terminal, doc.querySelector('#terminal-page'));
  assert.equal(terminal.hidden, true);
  assert.equal(doc.querySelector('#wake-page').hidden, false);
});

test('bootstrap failure offers retry without mounting unusable feature pages', async (t) => {
  const ui = await app(t, '');
  await ui.fail();
  assert.equal(ui.doc.querySelectorAll('.tool-page').length, 0);
  const error = ui.doc.querySelector('[role=alert]');
  assert.match(error.textContent, /无法连接服务/);
  flushSync(() => error.querySelector('button').click());
  await ui.ready();
  assert.equal(ui.doc.querySelector('#icons-page').hidden, false);
});
test('user navigation during bootstrap is not overwritten by saved default page', async (t) => {
  const ui = await app(t, '');
  flushSync(() => ui.doc.querySelector('[data-page=terminal]').click());
  await ui.ready();
  assert.equal(ui.doc.querySelector('#terminal-page').hidden, false);
});
