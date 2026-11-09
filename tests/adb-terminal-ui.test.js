import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { act } from 'react';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
const compiled = await build({
  entryPoints: ['web/adb-terminal.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  packages: 'external',
  plugins: [
    {
      name: 'terminal-boundaries',
      setup(b) {
        b.onResolve({ filter: /^@xterm\// }, (a) => ({ path: a.path, namespace: 'xterm' }));
        b.onLoad({ filter: /.*/, namespace: 'xterm' }, (a) => ({
          contents: a.path.endsWith('.css')
            ? ''
            : a.path.includes('addon-fit')
              ? 'export class FitAddon{fit(){}}'
              : `export class Terminal{constructor(){this.options={};globalThis.adbTerminalTest.term=this;}loadAddon(){}open(){}onData(fn){this.input=fn}write(value){(this.output??=[]).push(value)}writeln(){}dispose(){globalThis.adbTerminalTest.disposed++;}}`,
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
function setup(t) {
  const ui = remoteFixture(t),
    render = ui.render,
    previous = globalThis.WebSocket;
  globalThis.adbTerminalTest = { disposed: 0, sockets: [] };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    listeners = {};
    sent = [];
    constructor(url) {
      this.url = url;
      globalThis.adbTerminalTest.sockets.push(this);
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
  }
  globalThis.WebSocket = Socket;
  t.after(() => {
    globalThis.WebSocket = previous;
    delete globalThis.adbTerminalTest;
  });
  ui.render = (...args) =>
    act(async () => {
      await render(...args);
    });
  return ui;
}
test('ADB terminal sends device PTY input only for the active tab and closes resources', async (t) => {
  const ui = setup(t);
  ui.document.body.style.setProperty('--terminal-foreground', '#123456');
  let handle;
  const props = {
    sessionId: 's',
    active: true,
    toast() {},
    register: (value) => {
      handle = value;
    },
    api: async () => ({ ticket: 'a+b' }),
  };
  await ui.render(module.exports.AdbTerminal, props);
  assert.equal(globalThis.adbTerminalTest.term.options.theme.foreground, '#123456');
  const socket = globalThis.adbTerminalTest.sockets[0];
  assert.equal(socket.url, 'ws://localhost/app/deskicons/adb/ws?ticket=a%2Bb');
  assert.equal(handle.send('pwd\n'), true);
  assert.equal(new TextDecoder().decode(socket.sent[0]), 'pwd\n');
  await ui.render(module.exports.AdbTerminal, { ...props, active: false });
  assert.equal(handle.send('rm\n'), false);
  assert.equal(socket.sent.length, 1);
  await ui.unmount();
  assert.equal(socket.closed, true);
  assert.equal(globalThis.adbTerminalTest.disposed, 1);
  assert.equal(handle, null);
});
test('ADB terminal ignores a ticket arriving after view teardown', async (t) => {
  const ui = setup(t),
    pending = deferred();
  await ui.render(module.exports.AdbTerminal, {
    sessionId: 's',
    active: true,
    toast() {},
    register() {},
    api: async () => pending.promise,
  });
  await ui.unmount();
  await act(async () => {
    pending.resolve({ ticket: 'late' });
    await pending.promise;
  });
  assert.equal(globalThis.adbTerminalTest.sockets.length, 0);
  assert.equal(globalThis.adbTerminalTest.disposed, 1);
});
