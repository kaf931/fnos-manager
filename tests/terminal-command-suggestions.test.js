import { commandSeed } from '../server/persistence/command-seed.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shellCommandContext, commandSuggestions } from '../.web-test/terminal-command-catalog.js';
import { TerminalSuggestions } from '../.web-test/terminal-command-suggestions.js';
import { act } from 'react';
import { remoteFixture } from './helpers/remote-react-fixture.js';
function terminal(line = 'user@nas:~$ doc') {
  const handlers = {};
  const t = {
    cols: 80,
    rows: 24,
    line,
    cursor: line.length,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        get cursorX() {
          return t.cursor;
        },
        getLine: () => ({
          isWrapped: false,
          translateToString: (_trim, start = 0, end) => t.line.slice(start, end),
        }),
      },
    },
    onWriteParsed: (f) => ((handlers.write = f), { dispose() {} }),
    onResize: (f) => ((handlers.resize = f), { dispose() {} }),
    onScroll: (f) => ((handlers.scroll = f), { dispose() {} }),
    focus() {},
    handlers,
  };
  return t;
}
test('command hints read only a normal visible shell prompt and do not parse secrets or editing mid-line', () => {
  const t = terminal();
  assert.equal(shellCommandContext(t).input, 'doc');
  t.line = 'Password: doc';
  t.cursor = t.line.length;
  assert.equal(shellCommandContext(t), null);
  t.line = 'user@nas:~$ docker ps';
  t.cursor = 15;
  assert.equal(shellCommandContext(t), null);
  t.cursor = t.line.length;
  t.buffer.active.type = 'alternate';
  assert.equal(shellCommandContext(t), null);
  t.buffer.active.type = 'normal';
  t.buffer.active.viewportY = 1;
  assert.equal(shellCommandContext(t), null);
});
test('local command library matches names and parameters with Chinese explanations and never emits line breaks', () => {
  const result = commandSuggestions('docker ', commandSeed);
  assert.ok(result.some((x) => x.command === 'docker ps'));
  assert.ok(result.every((x) => x.description && !/[\r\n\x00]/.test(x.command)));
  assert.ok(result.length <= 12);
  assert.ok(commandSuggestions('df', commandSeed).some((x) => x.command === 'df -h'));
  assert.ok(
    commandSuggestions('sudo systemctl', commandSeed).some(
      (x) => x.command === 'sudo systemctl status ',
    ),
  );
  assert.deepEqual(commandSuggestions('docker ps; '), []);
  assert.deepEqual(commandSuggestions(''), []);
});
test('hints wait for echoed input, insert only the selected suffix, and preserve Tab/history/password input', async (t) => {
  const ui = remoteFixture(t),
    host = ui.document.querySelector('main');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 480 } });
  const term = terminal('user@nas:~$ do'),
    sent = [];
  let hints;
  await ui.render(TerminalSuggestions, {
    host: { current: host },
    terminal: term,
    enabled: true,
    api: async () => commandSeed,
    send: (value) => sent.push(value),
    register: (value) => {
      hints = value;
    },
  });
  await act(() => hints.input('c'));
  assert.equal(host.querySelector('[aria-label="命令提示"]'), null);
  term.line += 'c';
  term.cursor++;
  await act(() => term.handlers.write());
  const menu = host.querySelector('[aria-label="命令提示"]');
  assert.ok(menu);
  const item = [...menu.querySelectorAll('[data-command]')].find(
    (e) => e.dataset.command === 'docker ps',
  );
  assert.ok(item);
  await act(() => item.click());
  assert.deepEqual(sent, ['ker ps']);
  assert.ok(!sent[0].includes('\r'));
  assert.equal(host.querySelector('[aria-label="命令提示"]'), null);
  for (const value of ['\t', '\x1b[A']) {
    await act(() => {
      hints.input(value);
      term.handlers.write();
    });
    assert.equal(host.querySelector('[aria-label="命令提示"]'), null);
  }
  term.line = 'Password: ';
  term.cursor = term.line.length;
  await act(() => {
    hints.input('secret');
    term.handlers.write();
  });
  assert.equal(host.querySelector('[aria-label="命令提示"]'), null);
  term.line = 'user@nas:~$ do';
  term.cursor = term.line.length;
  await act(() => hints.input('c'));
  term.line += 'c';
  term.cursor++;
  await act(() => term.handlers.write());
  const stale = host.querySelector('[data-command]');
  term.line += 'x';
  term.cursor++;
  await act(() => stale.click());
  assert.equal(sent.length, 1);
});
