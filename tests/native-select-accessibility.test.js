import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { NativeSelect } from '../.web-test/native-select.js';
test('shared select exposes its supplied accessible label through Semi supported labelledby', () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeSelect, {
      'aria-label': '任务类型',
      value: 'script',
      optionList: [{ value: 'script', label: '脚本' }],
    }),
  );
  const dom = new JSDOM(html);
  const select = dom.window.document.querySelector('[role=combobox]');
  const label = dom.window.document.getElementById(select.getAttribute('aria-labelledby'));
  assert.equal(label?.textContent, '任务类型');
  dom.window.close();
});
test('shared select preserves an explicit external label without duplicating it', () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeSelect, {
      'aria-label': '类型',
      'aria-labelledby': 'external',
      value: 'ssh',
      optionList: [],
    }),
  );
  const dom = new JSDOM(html);
  assert.equal(
    dom.window.document.querySelector('[role=combobox]').getAttribute('aria-labelledby'),
    'external',
  );
  assert.equal(dom.window.document.querySelector('.sr-only'), null);
  dom.window.close();
});
