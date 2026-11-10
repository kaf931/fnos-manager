import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
const built = await build({
  stdin: {
    contents:
      "export {ConnectionCards} from './web/terminal-connections.tsx';export {icon} from './web/ui/icon-markup.tsx';",
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  plugins: [
    {
      name: 'semi-boundary',
      setup(b) {
        b.onResolve({ filter: /@douyinfe\/semi-ui\// }, () => ({
          path: 'semi',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default function Pass({children}){return children}',
          loader: 'jsx',
        }));
      },
    },
  ],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { ConnectionCards, icon } = compiled.exports;
test('reminder delivery action renders visible public artwork alongside edit and delete', () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      React.createElement(ConnectionCards, {
        rows: [{ id: 'reminder', name: '提醒' }],
        onAction: () => {},
        options: {
          actionLabel: '标记完成',
          editLabel: '编辑事项',
          deleteLabel: '删除事项',
          extraActions: () => [['records', '投递记录', 'clock']],
        },
      }),
    ),
  ).window.document;
  for (const [label, glyph] of [
    ['投递记录', 'clock'],
    ['编辑事项', 'edit'],
    ['删除事项', 'trash'],
  ]) {
    const button = doc.querySelector(`[aria-label="${label}"]`);
    assert.ok(button);
    const expected = new JSDOM(icon(glyph)).window.document.querySelector('svg');
    assert.equal(button.querySelector('svg').innerHTML, expected.innerHTML);
    assert.ok(!button.innerHTML.includes('undefined'));
  }
  assert.equal(doc.querySelector('[aria-label="投递记录"]').dataset.action, 'records');
});
test('delivery action dispatches the original reminder through the shared card action', () => {
  const row = { id: 'reminder', name: '提醒' };
  let received;
  const tree = ConnectionCards({
    rows: [row],
    onAction: (...args) => (received = args),
    options: { extraActions: () => [['records', '投递记录', 'clock']] },
  });
  const find = (node) => {
    if (!React.isValidElement(node)) return null;
    if (node.props.action === 'records') return node;
    return React.Children.toArray(node.props.children).map(find).find(Boolean);
  };
  const action = find(tree);
  assert.ok(action);
  action.props.onClick();
  assert.deepEqual(received, ['records', row]);
});
