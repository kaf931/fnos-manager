import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
const compiled = await build({
  entryPoints: ['web/adb-session.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  jsx: 'automatic',
  platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'adb-boundaries',
      setup(b) {
        b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-empty' }));
        b.onLoad({ filter: /.*/, namespace: 'css-empty' }, () => ({ contents: '' }));
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
        b.onResolve({ filter: /\/(adb-screen|adb-terminal)\.js$/ }, (a) => ({
          path: a.path,
          namespace: 'screen',
        }));
        b.onLoad({ filter: /.*/, namespace: 'screen' }, (a) => ({
          contents: a.path.includes('adb-terminal')
            ? `export function AdbTerminal(){return null}`
            : `import React from 'react';export function AdbScreen(p){React.useEffect(()=>{p.onControls?.(React.createElement('button',{'aria-label':'设备操作'},'back'));return()=>p.onControls?.(null)},[p.onControls]);return React.createElement('div',{'data-screen-session':p.sessionId})}`,
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
function adbFixture(t) {
  const ui = remoteFixture(t),
    render = ui.render;
  ui.render = (...args) =>
    act(async () => {
      await render(...args);
    });
  return ui;
}
const props = (api) => ({
  connection: { id: 'a', protocol: 'adb' },
  api,
  toast() {},
  active: true,
  controlsHost: null,
  panelHost: null,
  externalPanel: false,
  onPanelOpen() {},
  register() {},
  onSession() {},
});
const click = async (root, label) => {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  assert.ok(button, `missing ${label}`);
  await act(async () => button.click());
};
test('ADB exposes shared rail tools and loads real device info and file listing', async (t) => {
  const ui = adbFixture(t),
    calls = [],
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div');
  ui.document.body.append(controlsHost, panelHost);
  await ui.render(module.exports.AdbSession, {
    ...props(async (url, method) => {
      calls.push([url, method]);
      if (method === 'POST') return { id: 's', status: 'connected' };
      if (url.endsWith('/info')) return { properties: { 'ro.product.model': 'Test phone' } };
      if (url.includes('/files?'))
        return {
          path: '/sdcard',
          items: [{ name: 'DCIM', path: '/sdcard/DCIM', type: 'directory', size: 0 }],
        };
      return { items: [] };
    }),
    controlsHost,
    panelHost,
  });
  for (const label of ['投屏', '终端', '文件', '设备信息', '传输', '连接日志'])
    assert.ok(controlsHost.querySelector(`[aria-label="${label}"]`));
  assert.equal(controlsHost.querySelector('[aria-label="应用安装"]'), null);
  await click(controlsHost, '设备信息');
  assert.match(panelHost.textContent, /Test phone/);
  assert.match(panelHost.textContent, /型号/);
  assert.doesNotMatch(panelHost.textContent, /ro\.product\.model/);
  await click(controlsHost, '文件');
  assert.match(panelHost.textContent, /DCIM/);
  assert.ok(calls.some(([url]) => url === '/adb/sessions/s/info'));
  assert.ok(calls.some(([url]) => url === '/adb/sessions/s/files?path=%2Fsdcard'));
  assert.ok(panelHost.querySelector('aside.terminal-assets'));
});
test('late ADB creation is deleted after unmount and never publishes connected state', async (t) => {
  const ui = adbFixture(t),
    pending = deferred(),
    deleted = [],
    sessions = [];
  await ui.render(module.exports.AdbSession, {
    ...props(async (url, method) => {
      if (method === 'POST') return pending.promise;
      if (method === 'DELETE') deleted.push(url);
      return { items: [] };
    }),
    onSession: (s) => sessions.push(s),
  });
  await ui.unmount();
  await act(async () => {
    pending.resolve({ id: 'late' });
    await pending.promise;
  });
  assert.deepEqual(deleted, ['/adb/sessions/late']);
  assert.equal(
    sessions.some((s) => s.connected),
    false,
  );
});
test('ADB inactive tabs remove tools and panels and external assets closes own panel', async (t) => {
  const ui = adbFixture(t),
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div'),
    visibility = [];
  ui.document.body.append(controlsHost, panelHost);
  const base = {
    ...props(async (_, method) => (method === 'POST' ? { id: 's' } : { items: [] })),
    controlsHost,
    panelHost,
    onPanelOpen: (v) => visibility.push(v),
  };
  await ui.render(module.exports.AdbSession, base);
  await click(controlsHost, '连接日志');
  assert.ok(panelHost.querySelector('aside'));
  await ui.render(module.exports.AdbSession, { ...base, active: false });
  assert.equal(panelHost.childElementCount, 0);
  assert.equal(controlsHost.childElementCount, 0);
  await ui.render(module.exports.AdbSession, { ...base, active: true, externalPanel: true });
  assert.equal(panelHost.childElementCount, 0);
  assert.equal(visibility.at(-1), false);
});

test('ADB moves its shared tools and side panel into fullscreen and exits on tab switch', async (t) => {
  const ui = adbFixture(t),
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div');
  ui.document.body.append(controlsHost, panelHost);
  const base = {
    ...props(async (_, method) => (method === 'POST' ? { id: 's' } : { items: [] })),
    controlsHost,
    panelHost,
  };
  await ui.render(module.exports.AdbSession, base);
  await click(controlsHost, '连接日志');
  const viewport = ui.document.querySelector('.remote-desktop-viewport');
  let current = viewport,
    exits = 0;
  Object.defineProperty(ui.document, 'fullscreenElement', {
    configurable: true,
    get: () => current,
  });
  ui.document.exitFullscreen = async () => {
    exits++;
    current = null;
    ui.document.dispatchEvent(new window.Event('fullscreenchange'));
  };
  await act(async () => ui.document.dispatchEvent(new window.Event('fullscreenchange')));
  assert.ok(viewport.querySelector('.vnc-fullscreen-panel[aria-label="ADB 连接日志"]'));
  assert.ok(viewport.querySelector('.vnc-floating-toolbar'));
  assert.equal(panelHost.childElementCount, 0);
  await ui.render(module.exports.AdbSession, { ...base, active: false });
  assert.equal(exits, 1);
});

test('ADB terminal opens in the shared side panel and keeps the screen mounted', async (t) => {
  const ui = adbFixture(t),
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div');
  ui.document.body.append(controlsHost, panelHost);
  await ui.render(module.exports.AdbSession, {
    ...props(async (_, method) => (method === 'POST' ? { id: 's' } : { items: [] })),
    controlsHost,
    panelHost,
  });
  const screen = ui.document.querySelector('[data-screen-session="s"]');
  assert.ok(screen);
  await click(controlsHost, '终端');
  assert.ok(panelHost.querySelector('aside[aria-label="ADB 终端"]'));
  assert.equal(ui.document.querySelector('[data-screen-session="s"]'), screen);
  assert.ok(controlsHost.querySelector('[aria-label="设备操作"]'));
  await click(controlsHost, '终端');
  assert.equal(panelHost.childElementCount, 0);
  assert.equal(ui.document.querySelector('[data-screen-session="s"]'), screen);
});

test('APK installation stays in the file dialog on failure and opens transfers after success', async (t) => {
  const ui = adbFixture(t),
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div');
  ui.document.body.append(controlsHost, panelHost);
  const previous = globalThis.fetch;
  let attempt = 0;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(attempt++ === 0 ? { error: '模拟安装失败' } : { ok: true }), {
      status: attempt === 1 ? 400 : 200,
      headers: { 'content-type': 'application/json' },
    });
  t.after(() => {
    globalThis.fetch = previous;
  });
  await ui.render(module.exports.AdbSession, {
    ...props(async (url, method) =>
      method === 'POST'
        ? { id: 's' }
        : url.includes('/files?')
          ? { path: '/sdcard', items: [] }
          : { items: [] },
    ),
    controlsHost,
    panelHost,
  });
  await click(controlsHost, '文件');
  await click(panelHost, '应用安装');
  const dialog = ui.document.querySelector('dialog[open]'),
    input = dialog.querySelector('[aria-label="选择 APK"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new window.File(['apk'], 'test.apk')],
  });
  await act(() => Simulate.change(input));
  await act(() =>
    dialog
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.match(dialog.textContent, /模拟安装失败/);
  assert.ok(dialog.open);
  assert.ok(panelHost.querySelector('aside[aria-label="ADB 文件"]'));
  await act(() =>
    dialog
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.ok(panelHost.querySelector('aside[aria-label="ADB 传输"]'));
  assert.match(panelHost.textContent, /完成/);
});

test('ADB rail follows display, operation, information order with conditional retry last', async (t) => {
  const ui = adbFixture(t),
    controlsHost = ui.document.createElement('nav'),
    first = deferred(),
    second = deferred();
  ui.document.body.append(controlsHost);
  let attempts = 0;
  const base = [
    '全屏',
    '投屏',
    '终端',
    '文件',
    '设备操作',
    '设备信息',
    '传输',
    '连接日志',
    '断开连接',
  ];
  const labels = () =>
    [...controlsHost.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
  await ui.render(module.exports.AdbSession, {
    ...props(async (url, method) =>
      url === '/adb/sessions'
        ? attempts++ === 0
          ? first.promise
          : second.promise
        : method === 'DELETE'
          ? {}
          : { items: [] },
    ),
    controlsHost,
  });
  assert.deepEqual(labels(), base);
  assert.ok(controlsHost.querySelector('[aria-label="设备操作"]').disabled);
  await act(() => first.reject(new Error('设备离线')));
  assert.deepEqual(labels(), [...base, '重新连接']);
  await click(controlsHost, '重新连接');
  assert.deepEqual(labels(), base);
  await act(() => second.resolve({ id: 's' }));
  assert.deepEqual(labels(), base);
  await click(controlsHost, '断开连接');
  assert.deepEqual(labels(), [...base, '重新连接']);
  assert.ok(controlsHost.querySelector('[aria-label="设备操作"]').disabled);
});
