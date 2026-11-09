import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

test('VNC releases physical keys before entering read-only mode on a hidden tab', async () => {
  const dom = new JSDOM('<canvas tabindex="0"></canvas>', { url: 'http://localhost' });
  const saved = new Map();
  for (const name of [
    'window',
    'document',
    'navigator',
    'Image',
    'MutationObserver',
    'CustomEvent',
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  try {
    const built = await build({
      entryPoints: ['web/vnc-client.ts'],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      alias: {
        '@novnc/novnc/core/util/logging.js': './third-party/noVNC/core/util/logging.js',
        '@novnc/novnc': './third-party/noVNC/core/rfb.js',
      },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', built.outputFiles[0].text)(
      createRequire(import.meta.url),
      module,
      module.exports,
    );
    const { default: Keyboard } = await import('../third-party/noVNC/core/input/keyboard.js');
    const client = Object.create(module.exports.default.prototype);
    const packets = [];
    let packet = [];
    client._rfbConnectionState = 'connected';
    client._viewOnly = false;
    client._qemuExtKeyEventSupported = false;
    client._sock = {
      sQpush8: (v) => packet.push(v),
      sQpush16: (v) => packet.push(v >> 8, v & 255),
      sQpush32: (v) => packet.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255),
      flush() {
        packets.push(packet);
        packet = [];
      },
    };
    const canvas = dom.window.document.querySelector('canvas');
    client._keyboard = new Keyboard(canvas);
    client._keyboard.onkeyevent = (key, code, down) => client.sendKey(key, code, down);
    client._keyboard.grab();
    for (const [key, code] of [
      ['Control', 'ControlLeft'],
      ['Alt', 'AltLeft'],
      ['a', 'KeyA'],
    ])
      canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, code, bubbles: true }));
    assert.equal(packets.length, 3);
    client.setViewOnly(true);
    assert.deepEqual(packets.slice(3), [
      [4, 0, 0, 0, 0, 0, 255, 227],
      [4, 0, 0, 0, 0, 0, 255, 233],
      [4, 0, 0, 0, 0, 0, 0, 97],
    ]);
    assert.equal(client.viewOnly, true);
    client.setViewOnly(true);
    assert.equal(packets.length, 6, 'repeated visibility updates must not release keys twice');
    client.setViewOnly(false);
    canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', code: 'KeyB' }));
    canvas.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'b', code: 'KeyB' }));
    assert.deepEqual(packets.slice(6), [
      [4, 1, 0, 0, 0, 0, 0, 98],
      [4, 0, 0, 0, 0, 0, 0, 98],
    ]);
    client._keyboard.ungrab();
  } finally {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
