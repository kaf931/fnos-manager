import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';

import { remoteFixture } from './helpers/remote-react-fixture.js';
import { WorkspaceRail } from '../.web-test/ui/workspace-rail.js';

test('rail labels cover all buttons including nested icons, escape scroll clipping and dismiss', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(WorkspaceRail, {
    className: 'workspace-rail',
    children: React.createElement(
      'button',
      { 'aria-label': '无线配对' },
      React.createElement('svg'),
    ),
  });
  const button = ui.document.querySelector('button');
  await act(() =>
    button.querySelector('svg').dispatchEvent(new window.Event('pointerover', { bubbles: true })),
  );
  const tip = ui.document.querySelector('[role=tooltip]');
  assert.equal(tip.textContent, '无线配对');
  assert.equal(tip.parentElement, ui.document.body);
  assert.equal(button.closest('nav').querySelector('[role=tooltip]'), null);
  await act(() => button.closest('nav').dispatchEvent(new window.Event('scroll')));
  assert.equal(ui.document.querySelector('[role=tooltip]'), null);
  await act(() => button.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })));
  assert.equal(ui.document.querySelector('[role=tooltip]').textContent, '无线配对');
  await act(() =>
    button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  assert.equal(ui.document.querySelector('[role=tooltip]'), null);
  await act(() =>
    button.dispatchEvent(
      Object.assign(new window.Event('pointerover', { bubbles: true }), { pointerType: 'touch' }),
    ),
  );
  assert.equal(ui.document.querySelector('[role=tooltip]'), null);
});

test('fullscreen rails render labels inside their fullscreen root and clean up on unmount', async (t) => {
  const ui = remoteFixture(t),
    fullscreen = ui.document.createElement('section');
  ui.document.body.append(fullscreen);
  Object.defineProperty(ui.document, 'fullscreenElement', {
    configurable: true,
    value: fullscreen,
  });
  await ui.render(WorkspaceRail, {
    as: 'div',
    children: React.createElement('button', { 'aria-label': '退出全屏' }),
  });
  await act(() =>
    ui.document
      .querySelector('button')
      .dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })),
  );
  assert.equal(fullscreen.querySelector('[role=tooltip]').textContent, '退出全屏');
  await ui.unmount();
  assert.equal(fullscreen.querySelector('[role=tooltip]'), null);
});

test('portal controls receive the same labels despite belonging to a different React tree', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(WorkspaceRail, { className: 'workspace-rail' });
  const outer = ui.document.createElement('div');
  ui.document.body.append(outer);
  const root = createRoot(outer);
  await act(() =>
    root.render(
      createPortal(
        React.createElement('button', { 'aria-label': '重新连接' }, React.createElement('svg')),
        ui.document.querySelector('nav'),
      ),
    ),
  );
  try {
    await act(() =>
      ui.document
        .querySelector('button svg')
        .dispatchEvent(new window.Event('pointerover', { bubbles: true })),
    );
    assert.equal(ui.document.querySelector('[role=tooltip]').textContent, '重新连接');
  } finally {
    await act(() => root.unmount());
  }
});
test('labels flip left near the right edge and stay inside the bottom edge', async (t) => {
  const ui = remoteFixture(t);
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
  const original = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.getAttribute('role') === 'tooltip'
      ? { width: 120, height: 40 }
      : original.call(this);
  };
  await ui.render(WorkspaceRail, {
    children: React.createElement('button', { 'aria-label': '设备操作' }),
  });
  const button = ui.document.querySelector('button');
  button.getBoundingClientRect = () => ({ left: 350, right: 390, top: 270, height: 30 });
  await act(() => button.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true })));
  const tip = ui.document.querySelector('[role=tooltip]');
  assert.equal(tip.style.left, '222px');
  assert.equal(tip.style.top, '272px');
});
