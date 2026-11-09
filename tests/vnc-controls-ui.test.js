import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { VncControls } from '../.web-test/vnc-controls.js';
test('VNC controls use icon rail buttons, public tooltip labels, and no text toolbar', () => {
  const html = renderToStaticMarkup(
    React.createElement(VncControls, {
      fullscreen: false,
      keyboardOpen: false,
      connected: true,
      canRetry: false,
      onAction: () => {},
    }),
  );
  const doc = new JSDOM(html).window.document;
  const buttons = [...doc.querySelectorAll('button')];
  assert.equal(buttons.length, 7);
  for (const button of buttons) {
    assert.ok(button.querySelector('svg'));
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.querySelector('[role=tooltip]'), null);
  }
  assert.equal(doc.querySelector('[aria-label="全屏"]').getAttribute('aria-pressed'), 'false');
  assert.equal(doc.querySelector('.remote-desktop-toolbar'), null);
  assert.equal(doc.querySelector('[aria-label="连接日志"]').disabled, false);
  assert.equal(doc.querySelector('[aria-label="实际大小"]'), null);
});
test('VNC controls keep setup available and disable remote input while disconnected', () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(VncControls, {
        fullscreen: false,
        keyboardOpen: false,
        connected: false,
        canRetry: true,
        powerSupported: false,
        onAction: () => {},
      }),
    ),
  ).window.document;
  assert.equal(doc.querySelector('[aria-label="远程桌面设置"]').disabled, false);
  for (const label of ['剪贴板', '文字输入', '特殊按键', '断开连接']) {
    assert.equal(doc.querySelector(`[aria-label="${label}"]`).disabled, true);
  }
  assert.equal(doc.querySelector('[aria-label="重新连接"]').disabled, false);
  assert.equal(doc.querySelector('[aria-label="远程电源"]'), null);
});

test('VNC controls expose server power support and viewport drag selection', () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(VncControls, {
        fullscreen: false,
        keyboardOpen: false,
        connected: true,
        canRetry: false,
        settingsOpen: true,
        dragEnabled: true,
        dragging: true,
        powerSupported: true,
        onAction: () => {},
      }),
    ),
  ).window.document;
  assert.equal(doc.querySelector('[aria-label="远程电源"]').disabled, false);
  assert.equal(doc.querySelector('[aria-label="拖动视口"]').disabled, false);
  assert.equal(doc.querySelector('[aria-label="拖动视口"]').getAttribute('aria-pressed'), 'true');
  assert.equal(
    doc.querySelector('[aria-label="远程桌面设置"]').getAttribute('aria-pressed'),
    'true',
  );
});

test('conditional VNC tools follow all stable tools in both toolbar layouts', () => {
  for (const scope of ['rail', 'fullscreen']) {
    const render = (extra) =>
      new JSDOM(
        renderToStaticMarkup(
          React.createElement(VncControls, {
            fullscreen: scope === 'fullscreen',
            keyboardOpen: false,
            connected: true,
            canRetry: false,
            scope,
            onAction: () => {},
            ...extra,
          }),
        ),
      ).window.document;
    const labels = (doc) =>
      [...doc.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    const stable = labels(render({}));
    assert.deepEqual(stable, [
      scope === 'fullscreen' ? '退出全屏' : '全屏',
      '剪贴板',
      '文字输入',
      '特殊按键',
      '远程桌面设置',
      '连接日志',
      '断开连接',
    ]);
    const expanded = render({ dragEnabled: true, powerSupported: true, canRetry: true });
    assert.deepEqual(labels(expanded), [...stable, '拖动视口', '远程电源', '重新连接']);
    assert.ok(expanded.querySelector('[aria-label="断开连接"]').classList.contains('danger'));
  }
});
