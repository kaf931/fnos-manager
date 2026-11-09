import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';
import { SortableHeader } from '../.web-test/sortable-header.js';

test('sortable column exposes direction on the header and keeps a keyboard-operable sort button', (t) => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  const root = createRoot(document.querySelector('#root'));
  t.after(() => {
    root.unmount();
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  let calls = 0;
  flushSync(() =>
    root.render(
      React.createElement(
        'table',
        null,
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            React.createElement(SortableHeader, {
              label: '大小',
              direction: 'descending',
              onSort: () => calls++,
            }),
          ),
        ),
      ),
    ),
  );
  assert.equal(document.querySelector('th').getAttribute('aria-sort'), 'descending');
  assert.equal(document.querySelector('button').hasAttribute('aria-sort'), false);
  assert.equal(document.querySelector('button').getAttribute('aria-label'), '按大小排序');
  document.querySelector('button').click();
  assert.equal(calls, 1);
});
