import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

const built = await build({
  stdin: {
    contents:
      "export {VncControls} from './web/vnc-controls.tsx'; export {VncSettingsPanel} from './web/vnc-settings-panel.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { VncControls, VncSettingsPanel } = compiled.exports;
const defaults = {
  shared: true,
  viewOnly: false,
  clipViewport: false,
  scaleMode: 'scale',
  qualityLevel: 6,
  compressionLevel: 2,
  cursorMode: 'remote',
  showDotCursor: true,
  autoReconnect: false,
  reconnectDelay: 5000,
  repeaterId: '',
  logging: 'warn',
};
function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [
    node,
    ...React.Children.toArray(node.props.children).flatMap(elements),
    ...elements(node.props.render),
  ];
}

test('native controls dispatch modifiers and special keys and only menu selections dispatch power', () => {
  const actions = [];
  const popup = () => null;
  const nodes = elements(
    VncControls({
      fullscreen: false,
      keyboardOpen: false,
      connected: true,
      canRetry: true,
      powerSupported: true,
      dragEnabled: true,
      modifiers: { ctrl: true, alt: false, meta: true },
      getPopupContainer: popup,
      onAction: (action) => actions.push(action),
    }),
  );
  const buttons = nodes.filter((node) => node.type === 'button');
  for (const label of ['远程桌面设置', '拖动视口', '断开连接']) {
    buttons.find((node) => node.props['aria-label'] === label).props.onClick();
  }
  assert.deepEqual(actions, ['settings', 'drag', 'disconnect']);
  assert.equal(
    buttons.find((node) => node.props['aria-label'] === '远程电源').props.onClick,
    undefined,
  );
  const items = nodes.filter((node) => typeof node.type !== 'string' && node.props.onClick);
  for (const item of items) item.props.onClick();
  assert.deepEqual(actions.slice(3), [
    'ctrl',
    'alt',
    'meta',
    'tab',
    'ctrl-alt-delete',
    'alt-tab',
    'escape',
    'shutdown',
    'reboot',
    'reset',
  ]);
  assert.equal(nodes.filter((node) => node.props.getPopupContainer === popup).length, 2);
  assert.deepEqual(
    nodes
      .filter((node) => node.props.role === 'menuitemcheckbox')
      .map((node) => node.props['aria-checked']),
    [true, false, true],
  );
});

test('native settings show all noVNC preferences and lock reconnect-only fields during a connection', () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(VncSettingsPanel, {
        value: defaults,
        connected: true,
        onChange: () => {},
        onSave: () => {},
        onClose: () => {},
      }),
    ),
  ).window.document;
  assert.ok(doc.querySelector('.terminal-assets-header'));
  assert.ok(doc.querySelector('.terminal-tree.task-form-body'));
  assert.ok(doc.querySelector('.dialog-footer .primary'));
  assert.equal(doc.querySelectorAll('input[type="checkbox"]').length, 5);
  assert.equal(doc.querySelectorAll('.native-select').length, 3);
  for (const [label, value, min, max] of [
    ['图像质量（0–9）', '6', '0', '9'],
    ['压缩级别（0–9）', '2', '0', '9'],
    ['重连等待（毫秒）', '5000', '1000', '60000'],
  ]) {
    const id = [...doc.querySelectorAll('label')].find(
      (node) => node.textContent === label,
    ).htmlFor;
    const input = doc.getElementById(id);
    assert.deepEqual([input.value, input.min, input.max], [value, min, max]);
  }
  const shared = [...doc.querySelectorAll('label')]
    .find((node) => node.textContent === '共享连接')
    .querySelector('input');
  assert.equal(shared.disabled, true);
  assert.equal(doc.querySelector('input[type="text"]').disabled, true);
  assert.equal(doc.querySelector('input[type="text"]').maxLength, 250);
});

test('native settings remain editable before connect and protect input while saving', () => {
  for (const saving of [false, true]) {
    const doc = new JSDOM(
      renderToStaticMarkup(
        React.createElement(VncSettingsPanel, {
          value: { ...defaults, scaleMode: 'off' },
          connected: false,
          saving,
          onChange: () => {},
          onSave: () => {},
          onClose: () => {},
        }),
      ),
    ).window.document;
    for (const input of doc.querySelectorAll('input')) assert.equal(input.disabled, saving);
    assert.equal(doc.querySelector('.primary').disabled, saving);
  }
});

test('VNC dropdown triggers close their menu on a second click', () => {
  const nodes = elements(
    VncControls({
      fullscreen: false,
      keyboardOpen: false,
      connected: true,
      canRetry: false,
      powerSupported: true,
      onAction: () => {},
    }),
  );
  const menus = nodes.filter((node) => node.props.trigger === 'click');
  assert.equal(menus.length, 2);
  for (const menu of menus) assert.equal(menu.props.clickTriggerToHide, true);
});
