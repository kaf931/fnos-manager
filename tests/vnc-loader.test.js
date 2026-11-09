import test from 'node:test';
import assert from 'node:assert/strict';
import { loadVncModule } from '../.web-test/vnc-loader.js';
test('a stalled VNC module import expires instead of leaving the UI pending forever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = loadVncModule(() => new Promise(() => {}), 10000);
  const checked = assert.rejects(pending, /组件加载超时/);
  t.mock.timers.tick(10001);
  await checked;
});
test('VNC module loading resolves normally and reports import failures safely', async () => {
  const module = { default: 'client' };
  assert.equal(await loadVncModule(async () => module), module);
  await assert.rejects(
    () =>
      loadVncModule(async () => {
        throw Error('private module URL');
      }),
    (e) => /组件加载失败/.test(e.message) && !e.message.includes('private'),
  );
});
