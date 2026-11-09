import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUi, tick } from './fixtures/react-ui.js';
test('selecting AI history restores into active chat and closes the list', async (t) => {
  const requests = [],
    restored = [];
  const ui = await mountUi(t, 'terminal-ai-history', 'AiHistory', {
    api: async (path) => {
      requests.push(path);
      return [{ id: 'chat1', title: '历史对话', connectionName: 'NAS', updatedAt: 1 }];
    },
    toast() {},
    canRestore: true,
    onRestore: async (id) => {
      restored.push(id);
    },
  });
  ui.click('.terminal-ai-history-entry');
  await tick();
  assert.deepEqual(restored, ['chat1']);
  assert.deepEqual(requests, ['/terminal/ai/history']);
  assert.equal(ui.get('dialog'), null);
});
