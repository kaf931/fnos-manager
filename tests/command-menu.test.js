import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { remoteFixture } from './helpers/remote-react-fixture.js';
import { useCommandMenu } from '../.web-test/terminal-command-menu.js';
import { filterCommandCatalog } from '../.web-test/command-library.js';
test('catalog search matches commands parameters Chinese explanations and category together', () => {
  const catalog = [
    { command: 'docker ps -a', description: '查看全部容器', category: 'Docker' },
    { command: 'df -h', description: '磁盘空间', category: '系统' },
  ];
  assert.equal(filterCommandCatalog(catalog, '容器', 'Docker').length, 1);
  assert.equal(filterCommandCatalog(catalog, '-a').length, 1);
  assert.equal(filterCommandCatalog(catalog, 'DOCKER').length, 1);
  assert.equal(filterCommandCatalog(catalog, '容器', '系统').length, 0);
});
test('command context menu delegates edit/delete and dismisses without executing', async (t) => {
  const ui = remoteFixture(t),
    calls = [],
    entry = { id: 'one', command: 'docker ps' };
  function Fixture() {
    const menu = useCommandMenu({
      edit: (row) => calls.push(['edit', row.id]),
      remove: (row) => calls.push(['delete', row.id]),
    });
    return React.createElement(
      React.Fragment,
      null,
      React.createElement('button', menu.handlers(entry), 'docker ps'),
      menu.content,
    );
  }
  await ui.render(Fixture, {});
  const button = ui.document.querySelector('button');
  const open = () =>
    button.dispatchEvent(
      new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 80,
      }),
    );
  await act(open);
  assert.equal(ui.document.querySelector('[role=menu]').textContent, '编辑删除');
  await act(() => ui.document.querySelector('[role=menuitem]').click());
  assert.deepEqual(calls, [['edit', 'one']]);
  await act(open);
  await act(() => ui.document.querySelectorAll('[role=menuitem]')[1].click());
  assert.deepEqual(calls, [
    ['edit', 'one'],
    ['delete', 'one'],
  ]);
  await act(open);
  await act(() =>
    ui.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })),
  );
  assert.equal(ui.document.querySelector('[role=menu]'), null);
  await act(open);
  await act(() =>
    ui.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })),
  );
  assert.equal(ui.document.querySelector('[role=menu]'), null);
});
