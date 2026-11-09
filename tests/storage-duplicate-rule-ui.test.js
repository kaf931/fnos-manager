import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DuplicateManager } from '../.web-test/storage-duplicate-manager.js';

test('preferred directory plan requires preview and changing keeper invalidates the prior preview', async (t) => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const keys = [
    'Event',
    'CustomEvent',
    'document',
    'window',
    'HTMLElement',
    'Element',
    'Node',
    'ShadowRoot',
    'getComputedStyle',
    'matchMedia',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, {
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    document: dom.window.document,
    window: dom.window,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    ShadowRoot: dom.window.ShadowRoot,
    getComputedStyle: dom.window.getComputedStyle,
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.matchMedia = globalThis.matchMedia;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  t.after(async () => {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  const requests = [],
    directories = ['/preferred', '/target'];
  let processed = 0;
  const props = {
    api: async (url, method, body) => {
      requests.push({ url, method, body });
      return { results: [] };
    },
    toast() {},
    pickDirectory: async () => directories.shift(),
    onProcessed: async () => {
      processed++;
    },
  };
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () =>
    root.render(
      React.createElement(DuplicateManager, {
        ...props,
        job: { id: 'scan' },
        groups: [{ size: 4, paths: ['/other/a', '/preferred/z'] }],
        onClose: () => {},
      }),
    ),
  );

  const dialog = document.querySelector('dialog');
  const preferred = [...dialog.querySelectorAll('fieldset button')].find((button) =>
    button.textContent.includes('点击选择优先保留'),
  );
  await act(async () => preferred.click());
  assert.equal(dialog.querySelector('input[data-keep-group]:checked').value, '/preferred/z');
  await act(async () => dialog.querySelector('[data-directory]').click());
  const execute = () => dialog.querySelector('[data-execute]');
  assert.equal(execute().textContent, '预览处理计划');
  await act(async () => execute().click());
  assert.equal(requests.length, 0);
  assert.ok(dialog.querySelector('[aria-label="重复文件处理预览"]'));
  assert.equal(execute().textContent, '确认移动');
  await act(async () => dialog.querySelector('input[data-keep-group][value="/other/a"]').click());
  assert.equal(execute().textContent, '预览处理计划');
  assert.equal(dialog.querySelector('[aria-label="重复文件处理预览"]'), null);
  await act(async () => execute().click());
  assert.equal(requests.length, 0);
  await act(async () => execute().click());
  assert.equal(requests.length, 1);
  assert.equal(processed, 1);
  assert.deepEqual(requests[0], {
    url: '/storage/scans/scan/duplicates/process',
    method: 'POST',
    body: {
      action: 'move',
      destination: '/target',
      confirmed: true,
      items: [{ keep: '/other/a', path: '/preferred/z' }],
    },
  });
});
