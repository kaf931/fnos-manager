import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { ReactDialog } from '../.web-test/ui/react-dialog.js';
async function browser(t) {
  const dom = new JSDOM('<main/>');
  let mobile = true;
  const values = {
    document: dom.window.document,
    window: dom.window,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [k, value] of Object.entries(values))
    Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  dom.window.matchMedia = () => ({ matches: mobile });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.dataset.mode = 'modal';
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const root = createRoot(document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [k, v] of Object.entries(previous)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  return {
    render: (node) => act(() => root.render(node)),
    setMobile: (v) => {
      mobile = v;
    },
    dom,
  };
}
const dialog = (id, props = {}) =>
  React.createElement(
    ReactDialog,
    { key: id, id, open: true, title: '编辑记录', onClose() {}, ...props },
    React.createElement('input', { 'aria-label': '内容' }),
  );
test('React dialogs own mobile modality and release page state after the final editor closes', async (t) => {
  const ui = await browser(t);
  await ui.render(dialog('first'));
  assert.equal(document.querySelector('dialog').dataset.mode, 'modal');
  assert.ok(document.documentElement.classList.contains('mobile-form-page'));
  await ui.render(React.createElement(React.Fragment, null, dialog('first'), dialog('second')));
  await ui.render(dialog('second'));
  assert.ok(document.documentElement.classList.contains('mobile-form-page'));
  await ui.render(null);
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), false);
  ui.setMobile(false);
  await ui.render(dialog('desktop'));
  assert.equal(document.querySelector('dialog').dataset.mode, 'modal');
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), false);
});
test('React dialog titles stay accessible and busy dialogs block close and cancellation', async (t) => {
  const ui = await browser(t);
  let closes = 0;
  await ui.render(
    dialog('editor', {
      onClose: () => {
        closes++;
      },
      busy: true,
    }),
  );
  const element = document.querySelector('dialog'),
    id = element.getAttribute('aria-labelledby');
  assert.equal(document.getElementById(id).textContent, '编辑记录');
  assert.ok(element.querySelector('.dialog-close svg path'));
  assert.equal(element.querySelectorAll('[data-icon]').length, 0);
  await act(async () => {
    element.querySelector('.dialog-close').click();
    element.dispatchEvent(new window.Event('cancel', { bubbles: true, cancelable: true }));
  });
  assert.equal(closes, 0);
  await ui.render(
    dialog('editor', {
      onClose: () => {
        closes++;
      },
      title: '更新标题',
    }),
  );
  assert.equal(element.getAttribute('aria-labelledby'), id);
  assert.equal(document.getElementById(id).textContent, '更新标题');
  await act(async () => element.querySelector('.dialog-close').click());
  assert.equal(closes, 1);
});
test('React unmount clears dirty editor state without clearing another editor', async (t) => {
  const ui = await browser(t);
  const changes = [];
  window.addEventListener('deskicons:editstate', (e) => changes.push(e.detail.dirty));
  await ui.render(React.createElement(React.Fragment, null, dialog('one'), dialog('two')));
  await act(async () =>
    document
      .querySelector('#two input')
      .dispatchEvent(new window.Event('input', { bubbles: true })),
  );
  assert.equal(changes.at(-1), true);
  await ui.render(dialog('two'));
  assert.equal(changes.at(-1), true);
  await ui.render(null);
  assert.equal(changes.at(-1), false);
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), false);
});
test('failed showModal releases mobile page ownership', async (t) => {
  const ui = await browser(t);
  ui.dom.window.HTMLDialogElement.prototype.showModal = function () {
    throw Error('open failed');
  };
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(async () => await ui.render(dialog('broken')), /open failed/);
  } finally {
    console.error = original;
  }
  assert.equal(document.documentElement.classList.contains('mobile-form-page'), false);
});
