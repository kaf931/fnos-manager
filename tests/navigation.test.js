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
            'export function InboxDialog(){return null;}export function DesktopNotificationInbox(){return null;}export function NotificationInbox(){return null;}',
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
      (async (url) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('/notifications/templates') ||
          String(url).includes('/notifications/reminders')
            ? []
            : {
                native: true,
                gateway: false,
                csrfToken: 'token',
                version: 'test',
                hostname: 'nas',
              },
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
import { mobileNavigationIndex } from '../.web-test/navigation.js';
test('React App navigation shows exactly one page and retains mounted session state', async (t) => {
  await fixture(t);
  let last;
  window.addEventListener('deskicons:pagechange', (e) => (last = e.detail));
  for (const [page, title, index] of [
    ['terminal', '远程连接', 2],
    ['storage', '存储管理', 3],
    ['wake', '网络唤醒', 4],
    ['notifications', '通知中心', 4],
    ['tasks', '计划任务', 1],
  ]) {
    await act(async () => document.querySelector(`button[data-page="${page}"]`).click());
    assert.equal(document.title, title);
    assert.deepEqual(last, { page, title });
    assert.equal(document.documentElement.style.getPropertyValue('--nav-index'), String(index));
    assert.equal(document.querySelectorAll('main > section:not([hidden])').length, 1);
    assert.equal(document.querySelector(`#${page}-page`).hidden, false);
    assert.equal(
      document.querySelector(`button[data-page="${page}"]`).getAttribute('aria-current'),
      'page',
    );
  }
  await act(async () => document.querySelector('#tasks-page button').click());
  await act(async () => document.querySelector('button[data-page="icons"]').click());
  await act(async () => document.querySelector('button[data-page="tasks"]').click());
  assert.equal(document.querySelector('#tasks-page').textContent, 'count tasks 1');
  await act(async () => document.querySelector('#settings-open').click());
  assert.equal(document.title, '系统设置');
  assert.equal(document.documentElement.style.getPropertyValue('--nav-index'), '4');
  assert.equal(document.querySelector('#settings-page').hidden, false);
});
test('standalone launch never exposes the main sidebar while initialization is pending', async (t) => {
  let release;
  const promise = new Promise((r) => (release = r));
  await fixture(t, '?page=terminal&standalone=1', () => promise);
  assert.equal(document.querySelector('.sidebar').hidden, true);
  assert.equal(document.documentElement.dataset.page, 'terminal');
  await act(async () =>
    release({
      ok: true,
      status: 200,
      json: async () => ({ native: true, csrfToken: 'x', version: 'test' }),
    }),
  );
  assert.equal(document.querySelector('.sidebar').hidden, true);
  assert.equal(document.querySelector('#terminal-page').hidden, false);
});
test('more selection temporarily overrides the current page and restores its slot on close', () => {
  for (const [page, index] of [
    ['icons', 0],
    ['tasks', 1],
    ['terminal', 2],
    ['storage', 3],
    ['wake', 4],
    ['settings', 4],
  ]) {
    assert.equal(mobileNavigationIndex(page, false), index);
    assert.equal(mobileNavigationIndex(page, true), 4);
    assert.equal(mobileNavigationIndex(page, false), index);
  }
  assert.equal(mobileNavigationIndex('invalid'), 0);
});
test('notification menu remains mounted between navigation changes and preserves its DOM', async (t) => {
  await fixture(t);
  await act(async () => document.querySelector('button[data-page="notifications"]').click());
  const page = document.querySelector('#notifications-page');
  await act(async () => document.querySelector('button[data-page="icons"]').click());
  assert.equal(document.querySelector('#notifications-page'), page);
  assert.equal(page.hidden, true);
  await act(async () => document.querySelector('button[data-page="notifications"]').click());
  assert.equal(document.querySelector('#notifications-page'), page);
  assert.equal(page.hidden, false);
});
