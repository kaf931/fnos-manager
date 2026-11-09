import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppIcon } from '../.web-test/ui/icon-markup.js';

test('shared workspace icons render SVG geometry rather than bare path data', () => {
  for (const name of [
    'ai',
    'transfers',
    'library',
    'monitor',
    'window',
    'phone',
    'folder',
    'terminal',
  ]) {
    const markup = renderToStaticMarkup(React.createElement(AppIcon, { name }));
    assert.match(markup, /<(path|rect|circle)\b/, name);
    assert.doesNotMatch(markup, /<svg[^>]*>[Mm][\d ]/, name);
  }
});
