import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi } from './fixtures/react-ui.js';

test('a successful command write is not shown as failed when the catalog refresh fails', async (t) => {
  let writes = 0;
  const messages = [];
  const ui = await mountUi(t, 'terminal-command-editor', 'CommandEditor', {
    entry: null,
    api: async () => {
      writes++;
      return {};
    },
    onSave: async () => {
      throw new Error('refresh failed');
    },
    toast: (message) => messages.push(message),
  });
  await act(() =>
    ui.get('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes, 1);
  assert.ok(!ui.get('dialog'), 'the saved form must close even if catalog refresh fails');
  assert.match(messages.join(' '), /已保存.*刷新/);
});
