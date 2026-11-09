import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const built = await build({
  entryPoints: ['web/adb-controls.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
function nodes(node) {
  return React.isValidElement(node)
    ? [
        node,
        ...React.Children.toArray(node.props.children).flatMap(nodes),
        ...nodes(node.props.render),
      ]
    : [];
}
test('Android actions share one dropdown trigger with VNC interaction and dispatch correct keys', () => {
  const sent = [],
    actions = [];
  let toggled = 0;
  const control = module.exports.AdbControls({
    ready: true,
    software: true,
    onKey: (k) => sent.push(k),
    onSoftware: () => toggled++,
    onAction: (action) => actions.push(action),
  });
  assert.equal(control.props.trigger, 'click');
  assert.equal(control.props.clickTriggerToHide, true);
  assert.equal(control.props.spacing, 8);
  const html = renderToStaticMarkup(control);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /设备操作/);
  const entries = nodes(control.props.render).filter((n) => typeof n.props.onClick === 'function');
  entries.forEach((n) => n.props.onClick());
  assert.deepEqual(sent, [4, 3, 187, 224, 223, 24, 25]);
  assert.deepEqual(actions, ['rotate', 'display-off', 'display-on']);
  assert.equal(entries.find((node) => node.props.children === '唤醒屏幕').props.disabled, false);
  assert.equal(entries.find((node) => node.props.children === '熄灭屏幕').props.disabled, false);
  assert.equal(toggled, 1);
  for (const label of ['展开通知栏', '展开快捷设置', '收起系统面板'])
    assert.ok(!entries.some((node) => node.props.children === label));
  assert.ok(entries.some((node) => node.props.children === '关闭软件解码'));
  assert.equal(
    nodes(control).some((node) => node.props.role === 'menuitemcheckbox'),
    false,
  );
});
test('unready Android devices disable navigation but allow software decoder recovery', () => {
  const control = module.exports.AdbControls({
    ready: false,
    software: false,
    onKey() {},
    onSoftware() {},
    onAction() {},
  });
  const entries = nodes(control.props.render).filter((n) => typeof n.props.onClick === 'function');
  assert.ok(entries.slice(0, -1).every((n) => n.props.disabled));
  assert.equal(entries.at(-1).props.disabled, false);
  assert.equal(entries.at(-1).props.children, '开启软件解码');
  const unavailable = module.exports.AdbControls({
    available: false,
    ready: false,
    software: false,
    onKey() {},
    onSoftware() {},
    onAction() {},
  });
  assert.equal(unavailable.props.children.props.disabled, true);
  assert.ok(
    nodes(unavailable.props.render)
      .filter((node) => typeof node.props.onClick === 'function')
      .every((node) => node.props.disabled),
  );
});
test('screen quality presets are available for recovery and disable the current preset', () => {
  const changed = [];
  const control = module.exports.AdbControls({
    ready: false,
    software: false,
    maxSize: 1280,
    onKey() {},
    onAction() {},
    onSoftware() {},
    onSize: (size) => changed.push(size),
  });
  const entries = nodes(control.props.render).filter((n) => typeof n.props.onClick === 'function');
  const quality = entries.filter((n) =>
    String(n.props.children).match(/720px|1280px|1920px|原始分辨率/),
  );
  assert.equal(quality.length, 4);
  assert.deepEqual(
    quality.map((n) => n.props.disabled),
    [false, true, false, false],
  );
  for (const item of quality.filter((n) => !n.props.disabled)) item.props.onClick();
  assert.deepEqual(changed, [720, 1920, 0]);
});
