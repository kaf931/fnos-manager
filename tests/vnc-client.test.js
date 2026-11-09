import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const result = await build({
  entryPoints: ['web/vnc-client.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'rfb-boundary',
      setup(b) {
        b.onResolve({ filter: /novnc\/core\/util\/logging\.js$/ }, () => ({
          path: 'logging',
          namespace: 'logging',
        }));
        b.onLoad({ filter: /.*/, namespace: 'logging' }, () => ({
          contents: 'export function initLogging(){}',
        }));
        b.onResolve({ filter: /^@novnc\/novnc$/ }, () => ({ path: 'rfb', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      export default class RFB {
        events=[];
        dispatchEvent(event){this.events.push(event);return true;}
        _framebufferUpdate(){return this.ready??true;}
        _isSupportedSecurityType(type) { return [1,2,5,16,19,22,30,113,256].includes(type); }
      }
    `,
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const Client = compiled.exports.default;
test('diagnostic adapter reports authentication and the first completed framebuffer update once', () => {
  const c = new Client({}, 'ws://fixture', { credentials: { password: 'test' } });
  c._isSupportedSecurityType(2);
  assert.equal(c.events[0].type, 'authenticationselected');
  c.ready = false;
  c._framebufferUpdate();
  assert.equal(c.events.filter((e) => e.type === 'firstframe').length, 0);
  c.ready = true;
  c._framebufferUpdate();
  c._framebufferUpdate();
  assert.equal(c.events.filter((e) => e.type === 'firstframe').length, 1);
});
test('password-only VNC skips Apple account auth even when Mac advertises it first', () => {
  const c = new Client({}, 'ws://fixture', { credentials: { password: 'vnc-password' } });
  assert.equal(
    [30, 33, 36, 31, 32, 2, 35].find((t) => c._isSupportedSecurityType(t)),
    2,
  );
  for (const type of [1, 2, 5, 16, 19, 22, 113, 256])
    assert.equal(c._isSupportedSecurityType(type), true);
  assert.equal(c._isSupportedSecurityType(999), false);
});
test('Apple account auth requires Web Crypto and is not silently downgraded', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  assert.throws(
    () =>
      new Client({}, 'ws://fixture', { credentials: { username: 'mac-user', password: 'secret' } }),
    /HTTPS/,
  );
  const c = new Client({}, 'ws://fixture', { credentials: { password: 'vnc-password' } });
  assert.equal(c._isSupportedSecurityType(30), false);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {} } });
  const secure = new Client({}, 'wss://fixture', {
    credentials: { username: 'mac-user', password: 'secret' },
  });
  assert.equal(secure._isSupportedSecurityType(30), true);
});

test('performance sampling counts completed updates and resets each interval', () => {
  const c = new Client({}, 'ws://fixture', {});
  c.ready = false;
  c._framebufferUpdate();
  assert.equal(c.takeUpdateCount(), 0);
  c.ready = true;
  c._framebufferUpdate();
  c._framebufferUpdate();
  assert.equal(c.takeUpdateCount(), 2);
  assert.equal(c.takeUpdateCount(), 0);
});
