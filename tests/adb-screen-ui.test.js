import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { remoteFixture } from './helpers/remote-react-fixture.js';
const compiled = await build({
  entryPoints: ['web/adb-screen.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'react-dom/*'],
  plugins: [
    {
      name: 'screen-codec-boundaries',
      setup(b) {
        b.onResolve({ filter: /^@yume-chan\// }, (a) => ({ path: a.path, namespace: 'codec' }));
        b.onLoad({ filter: /.*/, namespace: 'codec' }, () => ({
          contents:
            'export const ScrcpyVideoCodecId={H264:1};export class TinyH264Decoder {} export class WebCodecsVideoDecoder {}',
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
test('screen uses shared viewport/status and publishes controls to the workspace rail only', async (t) => {
  const ui = remoteFixture(t);
  let controls = 'missing';
  const publish = (value) => {
    controls = value;
  };
  await act(async () => {
    await ui.render(module.exports.AdbScreen, {
      sessionId: 's',
      api: async () => ({ ticket: 't' }),
      active: false,
      onControls: publish,
    });
  });
  assert.equal(ui.document.querySelectorAll('button').length, 0);
  assert.ok(ui.document.querySelector('.remote-desktop-viewport > .remote-desktop-stage > canvas'));
  const markup = renderToStaticMarkup(controls);
  for (const label of ['设备操作']) assert.ok(markup.includes(label));
  assert.doesNotMatch(markup, /重新连接|全屏/);
  assert.match(markup, /icon-button/);
  assert.doesNotMatch(markup, /workspace-rail-tooltip/);
  await ui.unmount();
  assert.equal(controls, null);
});
test('screen quality changes use shared controls and retain the selected preset', async (t) => {
  const ui = remoteFixture(t);
  let controls;
  const publish = (value) => {
    controls = value;
  };
  await act(async () => {
    await ui.render(module.exports.AdbScreen, {
      sessionId: 's',
      api: async () => ({ ticket: 't' }),
      active: false,
      onControls: publish,
    });
  });
  assert.equal(controls.props.maxSize, 1280);
  await act(async () => controls.props.onSize(720));
  assert.equal(controls.props.maxSize, 720);
  await act(async () => controls.props.onSize(0));
  assert.equal(controls.props.maxSize, 0);
});
