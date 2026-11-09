import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { DEFAULT_VNC_SETTINGS } from '../server/domain/vnc.js';
const built = await build({
  stdin: {
    contents:
      "export {DesktopSession} from './web/remote-desktop.tsx'; export {default as RFB} from '@novnc/novnc';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  packages: 'external',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'view-boundaries',
      setup(b) {
        b.onResolve({ filter: /novnc\/core\/util\/logging\.js$/ }, () => ({
          path: 'logging',
          namespace: 'logging',
        }));
        b.onLoad({ filter: /.*/, namespace: 'logging' }, () => ({
          contents: 'export function initLogging(){}',
        }));
        b.onResolve({ filter: /\/vnc-settings-panel\.js$/ }, () => ({
          path: 'settings',
          namespace: 'settings',
        }));
        b.onLoad({ filter: /.*/, namespace: 'settings' }, () => ({
          contents:
            'export function VncSettingsPanel(props){globalThis.__vncProps.panel={kind:"settings",props};return null;}',
        }));
        b.onResolve({ filter: /^react(?:-dom)?$/ }, (args) => ({
          path: args.path,
          external: true,
        }));
        b.onResolve({ filter: /^@novnc\/novnc$/ }, () => ({ path: 'rfb', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      import {flushSync} from 'react-dom'; export default class RFB {
        static instances=[]; listeners=new Map(); keys=[]; capabilities={power:false};
        _keyboard={ungrab(){}};
        dispatchEvent(){return true;}
        constructor(){ RFB.instances.push(this); }
        _isSupportedSecurityType(t){return [1,2,30].includes(t);}
        addEventListener(t,cb){this.listeners.set(t,cb);}
        emit(t,detail={}){flushSync(()=>this.listeners.get(t)?.({detail}));}
        disconnect(){this.closed=true;}
        clipboardPasteFrom(text){this.sentClipboard=text;}
        sendKey(...args){this.keys.push(args);}
        sendCtrlAltDel(){this.cad=true;}
        machineShutdown(){this.power='shutdown';} machineReboot(){this.power='reboot';} machineReset(){this.power='reset';}
        focus(){} blur(){}
      }`,
        }));
        b.onResolve({ filter: /\/vnc-controls\.js$/ }, () => ({
          path: 'controls',
          namespace: 'controls',
        }));
        b.onLoad({ filter: /.*/, namespace: 'controls' }, () => ({
          contents: `import React from 'react'; export function VncControls(props){globalThis.__vncProps.controls=props;return React.createElement('button', {type:'button', 'aria-label':props.fullscreen?'退出全屏':'全屏', onClick:()=>props.onAction('fullscreen')});}`,
        }));
        b.onResolve({ filter: /\/confirmation\.js$/ }, () => ({
          path: 'confirmation',
          namespace: 'confirmation',
        }));
        b.onLoad({ filter: /.*/, namespace: 'confirmation' }, () => ({
          contents: 'export function createConfirmation(){return globalThis.__testConfirmation;}',
        }));
        b.onResolve({ filter: /\/vnc-(clipboard|log)-panel\.js$/ }, (args) => ({
          path: args.path,
          namespace: 'panel',
        }));
        b.onLoad({ filter: /.*/, namespace: 'panel' }, (args) => ({
          contents: args.path.includes('clipboard')
            ? 'import React from "react";export function VncClipboardPanel(props){globalThis.__vncProps.panel={kind:"clipboard",props};return React.createElement("div",{"aria-label":"VNC 剪贴板"});}'
            : 'import React from "react";export function VncLogPanel(props){globalThis.__vncProps.panel={kind:"logs",props};return React.createElement("div",{"aria-label":"VNC 连接日志"});}',
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { DesktopSession, RFB } = compiled.exports;
const connection = {
  id: 'mac',
  name: 'Mac',
  protocol: 'vnc',
  host: 'fixture',
  port: 5900,
  username: '',
  credentials: { password: 'fixture' },
};
function setup(
  t,
  readLogs = async () => ({ items: [] }),
  preferences = DEFAULT_VNC_SETTINGS,
  options = {},
) {
  const dom = new JSDOM('<div id="view"></div>', {
    url: 'http://nas.test/app/deskicons/',
    pretendToBeVisual: true,
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    ResizeObserver: globalThis.ResizeObserver,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  const calls = [];
  const root = createRoot(document.getElementById('view'));
  const controlsHost = document.createElement('nav'),
    panelHost = document.createElement('div');
  document.body.append(controlsHost, panelHost);
  globalThis.__vncProps = {};
  globalThis.__testConfirmation = options.confirm || (async () => true);
  let handle,
    identity = { connected: false },
    active = true,
    first = true;
  const props = {
    connection,
    controlsHost,
    panelHost,
    externalPanel: false,
    onPanelOpen() {},
    api: async (path, method, body) => {
      if (path === '/vnc/settings')
        return method === 'PUT'
          ? (options.saveSettings?.(body) ?? body)
          : (options.loadSettings?.() ?? { ...preferences });
      calls.push([path, method]);
      if (path.endsWith('/logs')) return readLogs();
      return { id: 's' + calls.length, ticket: 'fixture' };
    },
    toast() {},
    confirm: globalThis.__testConfirmation,
    register: (value) => {
      handle = value;
    },
    onSession: (value) => {
      identity = value;
    },
  };
  const render = () =>
    flushSync(() => root.render(createElement(DesktopSession, { ...props, active })));
  const wrapped = (props) =>
    Object.fromEntries(
      Object.entries(props).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? (...args) => {
              let result;
              flushSync(() => {
                result = value(...args);
              });
              return result;
            }
          : value,
      ]),
    );
  render();
  const view = {
    connect: async () => {
      if (first) first = false;
      else handle.reconnect();
      await new Promise((resolve) => setImmediate(resolve));
    },
    disconnect: () => handle.disconnect(),
    controls: () => ({ props: wrapped(globalThis.__vncProps.controls) }),
    panel: () => {
      const controls = globalThis.__vncProps.controls;
      if (
        document.fullscreenElement ||
        (!controls.logsOpen && !controls.clipboardOpen && !controls.settingsOpen)
      )
        return null;
      return { props: wrapped(globalThis.__vncProps.panel.props) };
    },
    panelLabel: () =>
      globalThis.__vncProps.controls.clipboardOpen
        ? 'VNC 剪贴板'
        : globalThis.__vncProps.controls.settingsOpen
          ? 'VNC 设置'
          : 'VNC 连接日志',
    hidePanel: () => {
      const c = globalThis.__vncProps.controls;
      flushSync(() =>
        c.onAction(c.clipboardOpen ? 'clipboard' : c.settingsOpen ? 'settings' : 'logs'),
      );
    },
    hide: () => {
      active = false;
      render();
    },
    show: () => {
      active = true;
      render();
    },
    get active() {
      return identity.connected;
    },
    dispose: () => flushSync(() => root.unmount()),
  };
  t.after(() => {
    view.dispose();
    controlsHost.remove();
    panelHost.remove();
    Object.assign(globalThis, previous);
    delete globalThis.__vncProps;
    delete globalThis.__testConfirmation;
    dom.window.close();
  });
  return { view, calls, doc: dom.window.document };
}
test('VNC pending and failure status are overlays inside the desktop viewport', async (t) => {
  const { view, doc } = setup(t);
  await view.connect(connection);
  assert.ok(doc.querySelector('.remote-desktop-viewport > [role="status"]'));
  assert.ok(doc.querySelector('[role="status"] .inline-loading'));
  const rfb = RFB.instances.at(-1);
  assert.equal(rfb.showDotCursor, true);
  rfb.emit('securityfailure', { reason: 'Invalid password' });
  assert.match(doc.querySelector('[role="alert"]').textContent, /Invalid password/);
  assert.equal(doc.querySelector('.inline-loading'), null);
});
test('late manual disconnect cannot overwrite a newer connected view', async (t) => {
  let finish;
  const pending = new Promise((r) => {
    finish = r;
  });
  let reads = 0;
  const { view, doc } = setup(t, () => (++reads === 1 ? pending : Promise.resolve({ items: [] })));
  await view.connect(connection);
  RFB.instances.at(-1).emit('connect');
  const closing = view.disconnect();
  await view.connect(connection);
  RFB.instances.at(-1).emit('connect');
  finish({ items: [] });
  await closing;
  assert.equal(view.active, true);
  assert.equal(!!doc.querySelector('.remote-desktop-status'), false);
});
test('a settings save survives reconnect and applies read-only and retry preferences to the new client', async (t) => {
  let finish;
  const saving = new Promise((r) => {
    finish = r;
  });
  const { view } = setup(t, undefined, DEFAULT_VNC_SETTINGS, { saveSettings: () => saving });
  await view.connect(connection);
  RFB.instances.at(-1).emit('connect');
  view.controls().props.onAction('settings');
  const desired = { ...DEFAULT_VNC_SETTINGS, viewOnly: true };
  view.panel().props.onChange(desired);
  view.panel().props.onSave();
  await view.connect(connection);
  const next = RFB.instances.at(-1);
  next.emit('connect');
  finish(desired);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(next.viewOnly, true);
});
test('pending VNC power confirmation cannot act after the view is hidden', async (t) => {
  let accept;
  const answer = new Promise((r) => {
    accept = r;
  });
  const { view } = setup(t, undefined, DEFAULT_VNC_SETTINGS, { confirm: () => answer });
  await view.connect(connection);
  const rfb = RFB.instances.at(-1);
  rfb.emit('connect');
  rfb.capabilities.power = true;
  view.controls().props.onAction('shutdown');
  view.hide();
  accept(true);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(rfb.power, undefined);
});
test('VNC fullscreen preserves scaling, offers an exit button, and consumes Escape locally', async (t) => {
  const { view, doc } = setup(t);
  await view.connect(connection);
  const rfb = RFB.instances.at(-1);
  const viewport = doc.querySelector('.remote-desktop-viewport');
  let active = null;
  Object.defineProperty(doc, 'fullscreenElement', { get: () => active });
  viewport.requestFullscreen = async () => {
    active = viewport;
    flushSync(() => doc.dispatchEvent(new window.Event('fullscreenchange')));
  };
  doc.exitFullscreen = async () => {
    active = null;
    flushSync(() => doc.dispatchEvent(new window.Event('fullscreenchange')));
  };
  assert.equal(rfb.resizeSession, false);
  assert.equal(rfb.scaleViewport, true);
  view.controls().props.onAction('fullscreen');
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(active, viewport);
  assert.ok(doc.querySelector('button[aria-label="退出全屏"]'));
  assert.equal(doc.querySelector('.remote-desktop-exit-fullscreen'), null);
  const collapse = doc.querySelector('button[aria-label="收起工具栏"]');
  assert.ok(collapse);
  collapse.click();
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(doc.querySelector('#vnc-fullscreen-tools'), null);
  doc.querySelector('button[aria-label="展开工具栏"]').click();
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.ok(doc.querySelector('#vnc-fullscreen-tools'));
  assert.equal(RFB.instances.at(-1), rfb);
  const escape = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  doc.dispatchEvent(escape);
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(active, null);
  assert.equal(doc.querySelector('button[aria-label="退出全屏"]'), null);
  view.controls().props.onAction('fullscreen');
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  doc.querySelector('button[aria-label="退出全屏"]').click();
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(active, null);
  assert.equal(rfb.scaleViewport, true);
  assert.equal(rfb.resizeSession, false);
});
test('fullscreen VNC keeps clipboard, text input and connection logs inside its surface', async (t) => {
  const { view, doc } = setup(t);
  await view.connect(connection);
  RFB.instances.at(-1).emit('connect');
  const viewport = doc.querySelector('.remote-desktop-viewport');
  let active = viewport;
  Object.defineProperty(doc, 'fullscreenElement', { get: () => active });
  flushSync(() => doc.dispatchEvent(new window.Event('fullscreenchange')));
  view.controls().props.onAction('keyboard');
  assert.ok(viewport.querySelector('input[aria-label="发送文字到远程桌面"]'));
  assert.equal(viewport.querySelector('dialog'), null);
  view.controls().props.onAction('clipboard');
  assert.ok(viewport.querySelector('[aria-label="VNC 剪贴板"]'));
  view.controls().props.onAction('logs');
  assert.ok(viewport.querySelector('[aria-label="VNC 连接日志"]'));
  assert.equal(view.panel(), null);
  active = null;
  flushSync(() => doc.dispatchEvent(new window.Event('fullscreenchange')));
  assert.ok(view.panel());
  assert.equal(doc.querySelector('.vnc-floating-toolbar'), null);
});
test('VNC log panel keeps failed reads out of cleared history and remains available after failure', async (t) => {
  let rejectRead;
  const pending = new Promise((_, reject) => {
    rejectRead = reject;
  });
  const { view } = setup(t, () => pending);
  await view.connect(connection);
  RFB.instances.at(-1).emit('securityfailure', { reason: 'Invalid fixture password' });
  view.controls().props.onAction('logs');
  assert.ok(view.panel().props.items.some((row) => row.level === 'error'));
  view.panel().props.onClear();
  rejectRead(new Error('backend request failed'));
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(view.panel().props.items.length, 0);
  view.hidePanel();
  assert.equal(view.panel(), null);
});
test('VNC clipboard uses the shared panel, retains drafts while switching tools and only sends explicitly', async (t) => {
  const { view, doc } = setup(t);
  await view.connect(connection);
  const rfb = RFB.instances.at(-1);
  rfb.emit('connect');
  view.controls().props.onAction('clipboard');
  assert.equal(view.panelLabel(), 'VNC 剪贴板');
  assert.equal(doc.querySelector('dialog'), null);
  view.panel().props.onChange('local draft');
  assert.equal(rfb.sentClipboard, undefined);
  view.controls().props.onAction('logs');
  assert.equal(view.panelLabel(), 'VNC 连接日志');
  view.controls().props.onAction('clipboard');
  assert.equal(view.panel().props.value, 'local draft');
  view.panel().props.onSend();
  assert.equal(rfb.sentClipboard, 'local draft');
  view.hidePanel();
  assert.equal(view.panel(), null);
});
test('native VNC modifiers, Tab, drag, read-only settings and gated power use the current connection', async (t) => {
  const { view } = setup(t);
  await view.connect(connection);
  const rfb = RFB.instances.at(-1);
  rfb.emit('connect');
  view.controls().props.onAction('ctrl');
  view.controls().props.onAction('tab');
  view.controls().props.onAction('ctrl');
  assert.deepEqual(rfb.keys, [
    [0xffe3, null, true],
    [0xff09, null],
    [0xffe3, null, false],
  ]);
  view.controls().props.onAction('shutdown');
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(rfb.power, undefined);
  rfb.capabilities.power = true;
  rfb.emit('capabilities');
  view.controls().props.onAction('reboot');
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(rfb.power, 'reboot');
  view.controls().props.onAction('settings');
  view.panel().props.onChange({ ...DEFAULT_VNC_SETTINGS, scaleMode: 'off', clipViewport: true });
  view.panel().props.onSave();
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  view.controls().props.onAction('drag');
  assert.equal(rfb.dragViewport, true);
  view.panel().props.onChange({ ...DEFAULT_VNC_SETTINGS, viewOnly: true });
  view.panel().props.onSave();
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(rfb.viewOnly, true);
  const count = rfb.keys.length;
  view.controls().props.onAction('tab');
  assert.equal(rfb.keys.length, count);
});
test('automatic VNC reconnect waits for the configured delay and explicit disconnect cancels it', async (t) => {
  const { view } = setup(t, undefined, {
    ...DEFAULT_VNC_SETTINGS,
    autoReconnect: true,
    reconnectDelay: 1000,
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await view.connect(connection);
  const first = RFB.instances.at(-1);
  first.emit('connect');
  const count = RFB.instances.length;
  first.emit('disconnect', { clean: false });
  t.mock.timers.tick(1001);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(RFB.instances.length, count + 1);
  RFB.instances.at(-1).emit('disconnect', { clean: false });
  await view.disconnect();
  t.mock.timers.tick(1001);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(RFB.instances.length, count + 1);
});
test('a stalled handshake fails and releases its session; a connected desktop has no overlay', async (t) => {
  const { view, calls, doc } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await view.connect(connection);
  const stale = RFB.instances.at(-1);
  t.mock.timers.tick(30001);
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.match(doc.querySelector('[role="alert"]').textContent, /超时/);
  assert.equal(stale.closed, true);
  assert.ok(calls.some(([p, m]) => p === '/vnc/sessions/s1' && m === 'DELETE'));
  await view.connect(connection);
  RFB.instances.at(-1).emit('connect');
  stale.emit('disconnect', { clean: false });
  stale.emit('securityfailure', { reason: 'late old authentication failure' });
  assert.equal(doc.querySelector('.remote-desktop-status'), null);
  t.mock.timers.tick(30001);
  assert.equal(view.active, true);
});
test('a slow initial preferences read cannot overwrite a newer successful save', async (t) => {
  let finish;
  const loading = new Promise((r) => {
    finish = r;
  });
  const { view } = setup(t, undefined, DEFAULT_VNC_SETTINGS, { loadSettings: () => loading });
  const connecting = view.connect(connection);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  view.controls().props.onAction('settings');
  view.panel().props.onChange({ ...DEFAULT_VNC_SETTINGS, viewOnly: true });
  view.panel().props.onSave();
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  finish({ ...DEFAULT_VNC_SETTINGS });
  await connecting;
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(RFB.instances.at(-1).viewOnly, true);
});
test('turning automatic reconnect off cancels the countdown and clears its pending status', async (t) => {
  const { view, doc } = setup(t, undefined, { ...DEFAULT_VNC_SETTINGS, autoReconnect: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await view.connect(connection);
  RFB.instances.at(-1).emit('disconnect', { clean: false });
  view.controls().props.onAction('settings');
  view.panel().props.onChange({ ...DEFAULT_VNC_SETTINGS });
  view.panel().props.onSave();
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  assert.doesNotMatch(doc.querySelector('.remote-desktop-status').textContent, /秒后/);
});

test('cursor mode switches live without reconnecting or leaking the local override into remote mode', async (t) => {
  const { view, doc } = setup(t);
  await view.connect(connection);
  const client = RFB.instances.at(-1);
  client.emit('connect');
  const count = RFB.instances.length;
  view.controls().props.onAction('settings');
  for (const cursorMode of ['local', 'remote']) {
    view.panel().props.onChange({ ...DEFAULT_VNC_SETTINGS, cursorMode });
    view.panel().props.onSave();
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(doc.querySelector('.remote-desktop-stage').dataset.cursorMode, cursorMode);
    assert.equal(RFB.instances.length, count);
    assert.equal(client.closed, undefined);
  }
});

test('VNC performance logs sample resolution and settings, and stop after disconnection', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { view, doc } = setup(t);
  await view.connect(connection);
  const rfb = RFB.instances.at(-1);
  const canvas = doc.createElement('canvas');
  canvas.width = 2560;
  canvas.height = 1440;
  doc.querySelector('.remote-desktop-stage').append(canvas);
  rfb.emit('connect');
  view.controls().props.onAction('logs');
  assert.ok(view.panel().props.items.some((r) => /图像质量 6\/9.*压缩 2\/9/.test(r.message)));
  flushSync(() => t.mock.timers.tick(10000));
  assert.ok(view.panel().props.items.some((r) => /2560×1440.*画面更新/.test(r.message)));
  rfb.emit('disconnect', { clean: true });
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
  const count = view.panel().props.items.filter((r) => r.stage === 'performance').length;
  flushSync(() => t.mock.timers.tick(30000));
  assert.equal(view.panel().props.items.filter((r) => r.stage === 'performance').length, count);
});
