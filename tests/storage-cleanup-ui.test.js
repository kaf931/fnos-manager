import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const output = await build({
  entryPoints: ['web/storage-cleanup.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { CleanupTable } = compiled.exports;
import { defaultHistoryLimits } from '../server/domain/maintenance.js';
test('application cleanup reuses shared table and disables protected and empty selections', () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(CleanupTable, {
        data: {
          limits: defaultHistoryLimits,
          items: [
            { kind: 'scans', count: 2, protected: 1, bytes: null },
            { kind: 'restoreReceipts', count: 1, protected: 1, bytes: null },
            { kind: 'serviceLog', count: 0, protected: 0, bytes: 0 },
          ],
        },
        selected: [],
        onSelect: () => {},
      }),
    ),
  ).window.document;
  assert.ok(doc.querySelector('.task-table.storage-table.record-table'));
  assert.ok(doc.querySelector('thead th:first-child input[type=checkbox]'));
  assert.ok(
    [...doc.querySelectorAll('tbody tr')].every((row) =>
      row.firstElementChild.querySelector('input[type=checkbox]'),
    ),
  );
  assert.equal(doc.querySelector('[aria-label="选择扫描记录"]').disabled, false);
  assert.equal(doc.querySelector('[aria-label="选择配置恢复回执"]').disabled, true);
  assert.equal(doc.querySelector('[aria-label="选择服务日志"]').disabled, true);
  assert.ok(doc.body.textContent.includes('10 MiB / 份'));
  assert.ok(!doc.body.textContent.includes('可释放'));
});

test('history categories open their existing list and the mobile view uses compact rows with selection at the beginning', () => {
  const opened = [];
  const props = {
    data: {
      limits: defaultHistoryLimits,
      items: ['scans', 'renames', 'operations', 'deliveries', 'serviceLog'].map((kind) => ({
        kind,
        count: 0,
        protected: 0,
        bytes: null,
      })),
    },
    selected: [],
    onSelect: () => {},
    onOpen: (mode) => opened.push(mode),
  };
  const nodes = (node) =>
    !React.isValidElement(node)
      ? []
      : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
  for (const node of nodes(CleanupTable(props))) if (node.type === 'button') node.props.onClick();
  assert.deepEqual(opened, [
    'scan-history',
    'rename-history',
    'operations',
    'deliveries',
    'service-log',
  ]);
  const doc = new JSDOM(
    renderToStaticMarkup(React.createElement(CleanupTable, { ...props, mobile: true })),
  ).window.document;
  assert.equal(doc.querySelector('table'), null);
  assert.equal(
    doc.querySelectorAll('.history-compact-row:not(.history-compact-select-all)').length,
    5,
  );
  for (const row of doc.querySelectorAll('.history-compact-row'))
    assert.equal(row.firstElementChild.type, 'checkbox');
  assert.equal(doc.querySelectorAll('button').length, 5);
  assert.ok(doc.querySelector('[aria-label="查看扫描记录"]'));
});

test('AI history and attachment management are centralized with their existing bounded policies', () => {
  const { cleanupRecordModes, cleanupLimitText } = compiled.exports;
  assert.equal(cleanupRecordModes.aiHistory, 'ai-chats');
  assert.equal(cleanupRecordModes.attachments, 'attachments');
  assert.equal(cleanupLimitText('aiHistory', defaultHistoryLimits), '50 个会话');
  assert.equal(cleanupLimitText('attachments', defaultHistoryLimits), '按需清理');
});
