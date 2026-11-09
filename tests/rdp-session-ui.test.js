import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
test('RDP desktop builds with the shared workspace controls and panels', async () => {
  const result = await build({
    entryPoints: ['web/rdp-desktop.tsx'],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    packages: 'external',
    loader: { '.css': 'empty' },
  });
  const text = result.outputFiles[0].text;
  assert.match(text, /remote-desktop-stage/);
  assert.match(text, /VncControls/);
  assert.match(text, /VncClipboardPanel/);
});

import { createRequire } from 'node:module';
import { act } from 'react';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
const compiled = await build({
  entryPoints: ['web/rdp-desktop.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  jsx: 'automatic',
  platform: 'node',
  packages: 'external',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'rdp-boundaries',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
        b.onResolve(
          {
            filter:
              /(?:third-party\/guacamole\/index|\/rdp-client|\/vnc-controls|\/vnc-floating-tools|\/vnc-clipboard-panel|\/vnc-log-panel)\.js$/,
          },
          (a) => ({ path: a.path, namespace: 'fixture' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents: a.path.includes('guacamole')
            ? `export default { WebSocketTunnel: class {constructor(url){globalThis.rdpTest.url=url}},Client:class{connect(query){globalThis.rdpTest.query=query}sendKeyEvent(...args){(globalThis.rdpTest.keys??=[]).push(args)}disconnect(){}} };`
            : a.path.includes('rdp-client')
              ? `export function mountRdpClient(){return {keyboard:{reset(){}},scale(){},dispose(){globalThis.rdpTest.disposed++}}};export function bindRdpEvents(instance,onError,onState){globalThis.rdpTest.onState=onState;globalThis.rdpTest.onError=onError}`
              : `import React from 'react';export function VncControls(p){globalThis.rdpTest.controls=p;return React.createElement('div',null,...['logs','clipboard','keyboard'].map(action=>React.createElement('button',{key:action,onClick:()=>p.onAction(action)},action)))}export function VncFloatingTools(p){return p.children}export function VncClipboardPanel(){return React.createElement('div',{'data-panel':'clipboard'})}export function VncLogPanel(p){globalThis.rdpTest.logItems=p.items;return React.createElement('div',{'data-panel':'logs'})}`,
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
function sessionProps(api) {
  return {
    connection: { id: 'r', protocol: 'rdp' },
    api,
    toast() {},
    active: true,
    controlsHost: null,
    panelHost: null,
    externalPanel: false,
    onPanelOpen() {},
    register() {},
    onSession() {},
  };
}
test('unmount during session creation closes the late session without connecting', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  t.after(() => delete globalThis.rdpTest);
  const ui = remoteFixture(t),
    pending = deferred(),
    deleted = [];
  await ui.render(
    module.exports.RdpSession,
    sessionProps(async (url, method) => {
      if (method === 'POST') return pending.promise;
      if (method === 'DELETE') deleted.push(url);
      return { items: [] };
    }),
  );
  await ui.unmount();
  await act(async () => {
    pending.resolve({ id: 'late', ticket: 't' });
    await pending.promise;
  });
  assert.deepEqual(deleted, ['/rdp/sessions/late']);
  assert.equal(globalThis.rdpTest.url, undefined);
});
test('Guacamole receives ticket exactly once and unmount disposes its adapter', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  t.after(() => delete globalThis.rdpTest);
  const ui = remoteFixture(t),
    deleted = [];
  await ui.render(
    module.exports.RdpSession,
    sessionProps(async (url, method) => {
      if (method === 'POST') return { id: 's', ticket: 'a+b' };
      if (method === 'DELETE') deleted.push(url);
      return { items: [] };
    }),
  );
  assert.equal(globalThis.rdpTest.url, 'ws://localhost/app/deskicons/rdp/ws');
  assert.equal(globalThis.rdpTest.query, 'ticket=a%2Bb');
  await ui.unmount();
  assert.equal(globalThis.rdpTest.disposed, 1);
  assert.deepEqual(deleted, ['/rdp/sessions/s']);
});

for (const kind of ['logs', 'clipboard']) {
  test(`RDP ${kind} uses the shared side panel container and fullscreen placement`, async (t) => {
    globalThis.rdpTest = { disposed: 0 };
    const ui = remoteFixture(t),
      controlsHost = ui.document.createElement('nav'),
      panelHost = ui.document.createElement('div');
    t.after(() => delete globalThis.rdpTest);
    ui.document.body.append(controlsHost, panelHost);
    const props = {
      ...sessionProps(async (_, method) =>
        method === 'POST' ? { id: 's', ticket: 'ticket' } : { items: [] },
      ),
      controlsHost,
      panelHost,
    };
    await ui.render(module.exports.RdpSession, props);
    await act(() =>
      [...controlsHost.querySelectorAll('button')].find((b) => b.textContent === kind).click(),
    );
    const label = kind === 'logs' ? 'RDP 连接日志' : 'RDP 剪贴板';
    const panel = panelHost.querySelector(`aside.terminal-assets[aria-label="${label}"]`);
    assert.ok(panel, 'regular panels must inherit the same mobile sheet and width rules as VNC');
    assert.ok(panel.querySelector(`[data-panel="${kind}"]`));
    assert.equal(panel.closest('.remote-desktop-viewport'), null);
    const viewport = ui.document.querySelector('.remote-desktop-viewport');
    Object.defineProperty(ui.document, 'fullscreenElement', {
      configurable: true,
      value: viewport,
    });
    await act(() => ui.document.dispatchEvent(new window.Event('fullscreenchange')));
    assert.equal(panelHost.childElementCount, 0);
    assert.ok(
      viewport.querySelector(`aside.terminal-assets.vnc-fullscreen-panel[aria-label="${label}"]`),
    );
  });
}

test('RDP shares connecting animation, error presentation and normal popup placement with VNC', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t),
    pending = deferred(),
    controlsHost = ui.document.createElement('nav');
  t.after(() => delete globalThis.rdpTest);
  ui.document.body.append(controlsHost);
  await ui.render(module.exports.RdpSession, {
    ...sessionProps(async (_, method) => (method === 'POST' ? pending.promise : { items: [] })),
    controlsHost,
  });
  assert.ok(ui.document.querySelector('.remote-desktop-status .inline-loading'));
  assert.equal(globalThis.rdpTest.controls.getPopupContainer, undefined);
  await act(async () => {
    pending.reject(new Error('连接失败'));
    await pending.promise.catch(() => {});
  });
  const failure = ui.document.querySelector('.remote-desktop-status.error[role="alert"]');
  assert.ok(failure);
  assert.match(failure.textContent, /连接失败/);
  assert.equal(failure.querySelector('.inline-loading'), null);
});

test('RDP uses the shared text input row and fullscreen popup container', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t),
    controlsHost = ui.document.createElement('nav');
  t.after(() => delete globalThis.rdpTest);
  ui.document.body.append(controlsHost);
  await ui.render(module.exports.RdpSession, {
    ...sessionProps(async (_, method) =>
      method === 'POST' ? { id: 's', ticket: 'ticket' } : { items: [] },
    ),
    controlsHost,
  });
  await act(() => globalThis.rdpTest.onState(3));
  await act(() => globalThis.rdpTest.controls.onAction('keyboard'));
  const form = ui.document.querySelector('form.remote-desktop-input.form-input-row');
  assert.ok(form);
  assert.ok(form.querySelector('input.form-input[aria-label="发送文字到远程桌面"]'));
  assert.equal(form.querySelector('button').disabled, false);
  await act(() =>
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.deepEqual(globalThis.rdpTest.keys, [
    [1, 65293],
    [0, 65293],
  ]);
  const viewport = ui.document.querySelector('.remote-desktop-viewport');
  Object.defineProperty(ui.document, 'fullscreenElement', { configurable: true, value: viewport });
  await act(() => ui.document.dispatchEvent(new window.Event('fullscreenchange')));
  assert.equal(globalThis.rdpTest.controls.getPopupContainer(), viewport);
  await act(() => globalThis.rdpTest.onState(5));
  assert.equal(form.querySelector('button').disabled, true);
});

test('RDP Escape exits only its own fullscreen and defers to open dialogs', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t);
  t.after(() => delete globalThis.rdpTest);
  await ui.render(
    module.exports.RdpSession,
    sessionProps(async (_, method) =>
      method === 'POST' ? { id: 's', ticket: 't' } : { items: [] },
    ),
  );
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
  const escape = () => {
    const event = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    viewport.dispatchEvent(event);
    return event;
  };
  const dialog = ui.document.createElement('dialog');
  dialog.setAttribute('open', '');
  viewport.append(dialog);
  assert.equal(escape().defaultPrevented, false);
  assert.equal(exits, 0);
  dialog.remove();
  await act(() => {
    assert.equal(escape().defaultPrevented, true);
  });
  assert.equal(exits, 1);
  assert.equal(current, null);
  current = ui.document.body;
  assert.equal(escape().defaultPrevented, false);
  assert.equal(exits, 1);
});

test('RDP side panel visibility ignores callback identity and follows the active tab', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t),
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div'),
    visible = [];
  t.after(() => delete globalThis.rdpTest);
  ui.document.body.append(controlsHost, panelHost);
  const base = {
    ...sessionProps(async (_, method) =>
      method === 'POST' ? { id: 's', ticket: 't' } : { items: [] },
    ),
    controlsHost,
    panelHost,
  };
  const render = (active) =>
    ui.render(module.exports.RdpSession, { ...base, active, onPanelOpen: (v) => visible.push(v) });
  await render(true);
  await act(() => globalThis.rdpTest.controls.onAction('logs'));
  assert.deepEqual(visible, [false, true]);
  await render(true);
  assert.deepEqual(visible, [false, true]);
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
  await render(false);
  assert.equal(exits, 1);
  assert.equal(current, null);
  assert.deepEqual(visible, [false, true, false]);
  assert.equal(panelHost.childElementCount, 0);
  await render(true);
  assert.deepEqual(visible, [false, true, false, true]);
  assert.ok(panelHost.querySelector('[aria-label="RDP 连接日志"]'));
});

test('RDP unmount exits fullscreen and removes its Escape listener', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t);
  t.after(() => delete globalThis.rdpTest);
  await ui.render(
    module.exports.RdpSession,
    sessionProps(async (_, method) =>
      method === 'POST' ? { id: 's', ticket: 't' } : { items: [] },
    ),
  );
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
  };
  await ui.unmount();
  assert.equal(exits, 1);
  current = viewport;
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(exits, 1);
});

test('selecting an RDP tab with no panel clears the previous tab side panel state', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t);
  t.after(() => delete globalThis.rdpTest);
  const visible = [],
    props = {
      ...sessionProps(async (_, method) =>
        method === 'POST' ? { id: 's', ticket: 't' } : { items: [] },
      ),
      onPanelOpen: (value) => visible.push(value),
    };
  await ui.render(module.exports.RdpSession, { ...props, active: false });
  await ui.render(module.exports.RdpSession, { ...props, active: true });
  assert.deepEqual(visible, [false, false]);
});

test('RDP client log does not claim a rendered desktop or authentication on transport readiness', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t),
    controlsHost = ui.document.createElement('nav'),
    panelHost = ui.document.createElement('div');
  t.after(() => delete globalThis.rdpTest);
  ui.document.body.append(controlsHost, panelHost);
  await ui.render(module.exports.RdpSession, {
    ...sessionProps(async (_, method) =>
      method === 'POST' ? { id: 's', ticket: 't' } : { items: [] },
    ),
    controlsHost,
    panelHost,
  });
  await act(() => globalThis.rdpTest.onState(3));
  await act(() => globalThis.rdpTest.controls.onAction('logs'));
  assert.ok(
    globalThis.rdpTest.logItems.some(
      (row) =>
        row.stage === 'desktop' &&
        row.message === '客户端显示通道已建立，等待远程画面；此状态不代表 Windows 登录成功',
    ),
  );
  assert.equal(
    globalThis.rdpTest.logItems.some((row) => row.message === '远程桌面已连接'),
    false,
  );
});

test('RDP displays the engine reason and retains it when a generic disconnect follows', async (t) => {
  globalThis.rdpTest = { disposed: 0 };
  const ui = remoteFixture(t);
  t.after(() => delete globalThis.rdpTest);
  await ui.render(
    module.exports.RdpSession,
    sessionProps(async (_, method) =>
      method === 'POST' ? { id: 's', ticket: 'ticket' } : { items: [] },
    ),
  );
  await act(async () => {
    globalThis.rdpTest.onError(
      519,
      'RDP 连接失败（状态 519）：TLS 连接失败。引擎原文：SSL/TLS connection failed',
    );
    globalThis.rdpTest.onError(512, '通用断线错误');
  });
  const text = ui.document.querySelector('.remote-desktop-status').textContent;
  assert.match(text, /519.*TLS/);
  assert.doesNotMatch(text, /通用断线错误|连接失败（512）/);
});
