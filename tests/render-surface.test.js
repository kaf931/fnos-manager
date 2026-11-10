import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const compiled = await build({
  entryPoints: ['web/app-shell.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.png': 'dataurl', '.ico': 'dataurl' },
  plugins: [
    {
      name: 'feature-boundaries',
      setup(b) {
        b.onResolve({ filter: /notification-inbox\.js$/ }, () => ({
          path: 'inbox',
          namespace: 'inbox-boundary',
        }));
        b.onLoad({ filter: /.*/, namespace: 'inbox-boundary' }, () => ({
          loader: 'js',
          contents:
            'export function DesktopNotificationInbox(){return null;}export function NotificationInbox(){return null;}',
        }));
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({ path: 'semi', namespace: 'semi' }));
        b.onLoad({ filter: /.*/, namespace: 'semi' }, () => ({
          loader: 'js',
          contents:
            'function Pass(p){return p.children;}Pass.Menu=Pass;Pass.Item=Pass;export default Pass;',
        }));
        b.onResolve(
          { filter: /features\/(icons|tasks|terminal|storage|wake)\/page\.js$/ },
          (a) => ({ path: a.path.match(/features\/(\w+)/)[1], namespace: 'page' }),
        );
        b.onResolve({ filter: /system-settings\.js$/ }, () => ({
          path: 'settings',
          namespace: 'page',
        }));
        b.onLoad({ filter: /.*/, namespace: 'page' }, (a) => ({
          loader: 'js',
          contents: `import React from 'react';function Page(p){const [count,setCount]=React.useState(0);if(globalThis.__brokenPage==='${a.path}')throw Error('fixture');return React.createElement('section',{id:'${a.path}-page',hidden:!p.active},React.createElement('button',{onClick:()=>setCount(v=>v+1)},'count ${a.path} '+count));}export {Page as IconsPage,Page as TasksPage,Page as RemoteConnectionPage,Page as StoragePage,Page as WakePage,Page as SettingsPage};`,
        }));
        b.onResolve(
          { filter: /(preferences|shared-scrollbars|mobile-navigation|platform)\.js$/ },
          (a) => ({ path: a.path, namespace: 'integration' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'integration' }, () => ({
          loader: 'js',
          contents:
            "export async function loadPreferences(){}export function getPreferences(){return {defaultPage:'icons',navigationMotion:false};}export function subscribePreferences(){return ()=>{};}export function setupSharedScrollbars(){return ()=>{};}export function setupMobileNavigation(){return ()=>{};}export async function initPlatform(){}",
        }));
      },
    },
  ],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { App } = module.exports;
async function fixture(t, search = '', fetcher) {
  const dom = new JSDOM('<main id="fixture"/>', {
    url: 'http://localhost/app/deskicons/' + search,
    pretendToBeVisual: true,
  });
  const values = {
    window: dom.window,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    document: dom.window.document,
    location: dom.window.location,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    fetch:
      fetcher ||
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          native: true,
          gateway: false,
          csrfToken: 'token',
          version: 'test',
          hostname: 'nas',
        }),
      })),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [k, value] of Object.entries(values))
    Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
  dom.window.matchMedia = () => ({ matches: false });
  const root = createRoot(document.querySelector('#fixture'));
  t.after(async () => {
    await act(async () => root.unmount());
    delete globalThis.__brokenPage;
    dom.window.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  await act(async () => root.render(React.createElement(App)));
  return { root, dom };
}
test('App feature errors remain local and React boundary retry renders recovered content', async (t) => {
  globalThis.__brokenPage = 'terminal';
  const original = console.error;
  console.error = () => {};
  try {
    await fixture(t);
    assert.equal(document.querySelector('#icons-page').textContent, 'count icons 0');
    assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(document.querySelectorAll('[data-surface-root]').length, 0);
    delete globalThis.__brokenPage;
    await act(async () => document.querySelector('[role="alert"] button').click());
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(document.querySelector('#terminal-page').textContent, 'count terminal 0');
    assert.equal(document.querySelector('#icons-page').textContent, 'count icons 0');
  } finally {
    console.error = original;
  }
});
test('App rerenders preserve page identity instead of mounting independent surface roots', async (t) => {
  const { root } = await fixture(t);
  const page = document.querySelector('#icons-page');
  await act(async () => document.querySelector('#icons-page button').click());
  await act(async () => root.render(React.createElement(App)));
  assert.equal(document.querySelector('#icons-page'), page);
  assert.equal(page.textContent, 'count icons 1');
  assert.equal(document.querySelectorAll('#icons-page').length, 1);
});
