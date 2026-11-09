import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createConfirmation, ConfirmationHost } from '../.web-test/confirmation.js';

test('confirmation blocks dismissal and duplicate submission while busy, reports errors and permits retry', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = {
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    document: globalThis.document,
    window: globalThis.window,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(React.createElement(ConfirmationHost)));
  try {
    const confirm = createConfirmation();
    let calls = 0,
      release;
    let result;
    act(() => {
      result = confirm({
        text: '确认',
        onAccept: () => {
          calls++;
          return new Promise((resolve, reject) => {
            release = { resolve, reject };
          });
        },
      });
    });
    const dialog = document.querySelector('dialog');
    const click = () => dialog.querySelector('[data-accept]').click();
    act(() => {
      click();
      click();
    });
    assert.equal(calls, 1);
    const cancel = new dom.window.Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    confirm.cancel();
    assert.equal(dialog.open, true);
    await act(async () => {
      release.reject(new Error('暂时失败'));
    });
    assert.equal(dialog.querySelector('[role="alert"]').textContent, '暂时失败');
    assert.equal(dialog.querySelector('[data-accept]').disabled, false);
    act(click);
    await act(async () => {
      release.resolve();
    });
    assert.equal(await result, true);
    assert.equal(document.querySelector('dialog'), null);
    let cancelled;
    act(() => {
      cancelled = confirm();
    });
    await act(async () => {
      confirm.cancel();
    });
    assert.equal(await cancelled, false);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
