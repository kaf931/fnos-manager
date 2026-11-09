import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { PasswordField } from '../.web-test/password-field.js';
test('controlled API keys remain masked initially and a new field lifecycle resets visibility', async (t) => {
  const dom = new JSDOM('<main/>');
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  const render = (key) =>
    act(() =>
      root.render(
        React.createElement(PasswordField, {
          key,
          label: 'API Key',
          value: 'fixture-key',
          onChange() {},
        }),
      ),
    );
  await render('first');
  const input = document.querySelector('input'),
    toggle = document.querySelector('button');
  const style = document.createElement('style');
  style.textContent = readFileSync(
    new URL('../web/styles/shared-controls.css', import.meta.url),
    'utf8',
  );
  document.head.append(style);
  assert.equal(dom.window.getComputedStyle(toggle).position, 'absolute');
  assert.equal(dom.window.getComputedStyle(toggle).width, '28px');
  assert.equal(input.type, 'password');
  assert.equal(toggle.getAttribute('aria-label'), '显示API Key');
  assert.equal(toggle.getAttribute('aria-controls'), input.id);
  await act(async () => toggle.click());
  assert.equal(input.type, 'text');
  assert.equal(toggle.getAttribute('aria-label'), '隐藏API Key');
  assert.equal(input.value, 'fixture-key');
  await render('second');
  assert.equal(document.querySelector('input').type, 'password');
  assert.equal(document.querySelector('input').value, 'fixture-key');
});
