import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const built = await build({
  entryPoints: ['web/rdp-client.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  plugins: [
    {
      name: 'guacamole-input-boundary',
      setup(b) {
        b.onResolve({ filter: /third-party\/guacamole\/index\.js$/ }, () => ({
          path: 'guacamole',
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
    class Keyboard {
      pressed=new Set();
      press(key){this.pressed.add(key);this.onkeydown?.(key)}
      release(key){this.pressed.delete(key);this.onkeyup?.(key)}
      reset(){for(const key of [...this.pressed])this.release(key)}
    }
    class Mouse {onEach(){}} Mouse.Touchscreen=Mouse;Mouse.Event=class {};
    export default {Keyboard,Mouse};
  `,
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
function setup(t) {
  const dom = new JSDOM('<main></main>'),
    previous = globalThis.ResizeObserver,
    events = [];
  let active = true;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const display = {
    getElement: () => dom.window.document.createElement('div'),
    getWidth: () => 1280,
    getHeight: () => 720,
    scale() {},
  };
  const client = {
    getDisplay: () => display,
    sendKeyEvent: (...args) => events.push(args),
    disconnect: () => events.push('disconnect'),
  };
  const adapter = module.exports.mountRdpClient(
    dom.window.document.querySelector('main'),
    client,
    () => active,
    () => {},
  );
  t.after(() => {
    adapter.dispose();
    dom.window.close();
    if (previous === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previous;
  });
  return {
    adapter,
    events,
    setActive: (value) => {
      active = value;
    },
  };
}
test('RDP releases accepted physical keys after switching to an inactive tab', (t) => {
  const { adapter, events, setActive } = setup(t);
  for (const key of [65507, 65513, 97]) adapter.keyboard.press(key);
  setActive(false);
  adapter.keyboard.reset();
  assert.deepEqual(events, [
    [1, 65507],
    [1, 65513],
    [1, 97],
    [0, 65507],
    [0, 65513],
    [0, 97],
  ]);
  adapter.keyboard.release(65507);
  assert.equal(events.length, 6, 'a duplicate keyup must not affect the remote key state');
});
test('RDP ignores inactive keydown and does not send an unmatched keyup after activation', (t) => {
  const { adapter, events, setActive } = setup(t);
  setActive(false);
  adapter.keyboard.press(65507);
  setActive(true);
  adapter.keyboard.release(65507);
  assert.deepEqual(events, []);
  adapter.keyboard.press(98);
  adapter.keyboard.release(98);
  assert.deepEqual(events, [
    [1, 98],
    [0, 98],
  ]);
});
test('RDP disposal releases held keys before disconnecting', (t) => {
  const { adapter, events, setActive } = setup(t);
  adapter.keyboard.press(65515);
  setActive(false);
  adapter.dispose();
  assert.deepEqual(events, [[1, 65515], [0, 65515], 'disconnect']);
});
