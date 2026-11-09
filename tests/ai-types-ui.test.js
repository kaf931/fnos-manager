import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUi, tick } from './fixtures/react-ui.js';
test('React history keeps fifty entries and disables restore when disconnected', async (t) => {
  const ui = await mountUi(t, 'terminal-ai-history', 'AiHistory', {
    api: async () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: String(i),
        title: 'Chat ' + i,
        connectionName: 'NAS',
        updatedAt: i,
      })),
    toast() {},
    canRestore: false,
    onRestore: async () => assert.fail('Disconnected restore'),
  });
  assert.equal(document.querySelectorAll('.terminal-ai-history-entry').length, 50);
  assert.ok([...document.querySelectorAll('.terminal-ai-history-entry')].every((e) => e.disabled));
  ui.close();
  assert.equal(ui.get('dialog'), null);
});
test('unmounted history ignores delayed catalog response', async (t) => {
  let resolve;
  const ui = await mountUi(t, 'terminal-ai-history', 'AiHistory', {
    api: () => new Promise((r) => (resolve = r)),
    toast() {},
    canRestore: false,
    onRestore: async () => {},
  });
  ui.close();
  resolve([{ id: 'stale', title: 'Stale', connectionName: 'NAS', updatedAt: 0 }]);
  await tick();
  assert.equal(ui.get('dialog'), null);
});
