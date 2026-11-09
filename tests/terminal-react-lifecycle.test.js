import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';
import { askName } from '../.web-test/terminal-file-name-dialog.js';
import { RemoteDialogHost } from '../.web-test/features/terminal/dialogs.js';
import { MonitorSummary } from '../.web-test/terminal-indicators.js';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
test('name dialog cancellation settles promise and unmount cancels pending requests', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(RemoteDialogHost, {});
  let first;
  await act(() => {
    first = askName('重命名', '初始.txt');
  });
  assert.equal(ui.document.querySelector('input').value, '初始.txt');
  await act(() => ui.document.querySelector('.dialog-close').click());
  assert.equal(await first, null);
  assert.equal(ui.document.querySelector('dialog'), null);
  let second;
  await act(() => {
    second = askName('新建目录');
  });
  await ui.unmount();
  assert.equal(await second, null);
  assert.equal(ui.document.querySelector('dialog'), null);
});
test('monitor summary updates through props and clears units for missing samples', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(MonitorSummary, { data: null });
  assert.equal(ui.document.querySelector('[data-monitor=cpu]').textContent, '—');
  await ui.render(MonitorSummary, {
    data: {
      cpu: { percent: 12 },
      memory: { percent: 34 },
      disk: { percent: 56 },
      network: [{ name: 'eth0', receiveRate: 1024, transmitRate: 2048 }],
      defaultInterfaces: ['eth0'],
    },
  });
  assert.equal(ui.document.querySelector('[data-monitor=cpu]').textContent, '12%');
  assert.equal(ui.document.querySelector('[data-monitor=upload]').textContent, '2');
  assert.equal(ui.document.querySelector('[data-monitor-unit=upload]').textContent, 'KB/s');
  await ui.render(MonitorSummary, { data: null });
  assert.equal(ui.document.querySelector('[data-monitor-unit=upload]').hidden, true);
});
let serial = 0;
async function sessionFixture(t, api) {
  const ui = remoteFixture(t),
    out = path.resolve('.web-test/ssh-lifecycle-' + ++serial + '.js');
  await build({
    entryPoints: ['web/terminal-view.tsx'],
    outfile: out,
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    plugins: [
      {
        name: 'terminal-sdk-fixtures',
        setup(build) {
          build.onResolve(
            { filter: /^@xterm\/|\/(?:terminal-files|terminal-command-suggestions)\.js$/ },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
            if (args.path.endsWith('.css')) return { contents: '' };
            if (args.path.includes('addon-fit'))
              return { contents: 'export class FitAddon {fit(){}}' };
            if (args.path.includes('terminal-files'))
              return { contents: 'export function TerminalFiles(){return null;}' };
            if (args.path.includes('terminal-command-suggestions'))
              return { contents: 'export function TerminalSuggestions(){return null;}' };
            return {
              contents: `export class Terminal {constructor(){this.cols=80;this.rows=24;this.options={};this.buffer={active:{cursorX:0,cursorY:0}};globalThis.__sshTest.instances.push(this);}loadAddon(){}open(){}write(value,done){done?.();}reset(){}resize(){}focus(){}onScroll(){return{dispose(){}};}onData(fn){this.data=fn;return{dispose(){}};}dispose(){this.disposed=true;}}`,
            };
          });
        },
      },
    ],
  });
  t.after(() => rm(out, { force: true }));
  const state = { instances: [], sockets: [] };
  const previous = {};
  for (const [key, value] of Object.entries({
    __sshTest: state,
    location: { protocol: 'http:', host: 'localhost' },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    WebSocket: class {
      static OPEN = 1;
      readyState = 1;
      constructor() {
        state.sockets.push(this);
      }
      send(text) {
        this.sent ??= [];
        this.sent.push(JSON.parse(text));
      }
      close() {
        this.closed = true;
      }
    },
  })) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  t.after(() => {
    for (const key in previous) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  });
  const { TerminalSession } = await import(pathToFileURL(out).href);
  const props = {
    connection: { id: 'one', name: 'NAS', kind: 'local', host: 'nas', port: 22, username: 'root' },
    api,
    toast() {},
    state: { csrfToken: '' },
    confirm: async () => true,
    active: true,
    onSession() {},
    register() {},
  };
  await ui.render(TerminalSession, props);
  return { ...ui, state, Component: TerminalSession, props };
}
test('SSH survives menu hiding and releases socket and server session on unmount', async (t) => {
  const calls = [];
  const ui = await sessionFixture(t, async (path, method) => {
    calls.push([path, method]);
    return { id: 'session-one', ticket: 'secret' };
  });
  assert.equal(ui.state.sockets.length, 1);
  const socket = ui.state.sockets[0];
  await act(() => socket.onopen());
  assert.deepEqual(socket.sent[0], { type: 'authenticate', id: 'session-one', ticket: 'secret' });
  await ui.render(ui.Component, { ...ui.props, active: false });
  assert.equal(socket.closed, undefined);
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 1);
  await ui.render(ui.Component, ui.props);
  assert.equal(ui.state.instances.length, 1);
  await ui.unmount();
  assert.equal(socket.closed, true);
  assert.equal(ui.state.instances[0].disposed, true);
  assert.ok(
    calls.some(
      ([path, method]) => path === '/terminal/sessions/session-one' && method === 'DELETE',
    ),
  );
});
test('late SSH creation after unmount is released without opening a socket', async (t) => {
  const pending = deferred(),
    calls = [];
  const ui = await sessionFixture(t, (path, method) => {
    calls.push([path, method]);
    return method === 'POST' ? pending.promise : Promise.resolve();
  });
  await ui.unmount();
  await act(() => pending.resolve({ id: 'late', ticket: 'unused' }));
  assert.equal(ui.state.sockets.length, 0);
  assert.ok(
    calls.some(([path, method]) => path === '/terminal/sessions/late' && method === 'DELETE'),
  );
});

test('SSH one-time authentication discards a key file after switching authentication methods', async (t) => {
  const ui = await sessionFixture(t, async () => ({ id: 'session-one', ticket: 'secret' }));
  await act(() =>
    ui.state.sockets[0].onmessage({ data: JSON.stringify({ type: 'credentials-required' }) }),
  );
  await act(() => ui.document.querySelectorAll('input[type=radio]')[1].click());
  const pending = deferred(),
    input = ui.document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ size: 32, text: () => pending.promise }],
  });
  await act(() => Simulate.change(input));
  await act(() => ui.document.querySelectorAll('input[type=radio]')[0].click());
  await act(() => ui.document.querySelectorAll('input[type=radio]')[1].click());
  await act(() => pending.resolve('obsolete-key'));
  assert.equal(ui.document.querySelector('textarea').value, '');
});
