import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi, tick } from './fixtures/react-ui.js';

test('switching skill files discards the previous file offset when the new read fails', async (t) => {
  const calls = [];
  const ui = await mountUi(t, 'terminal-ai-skill-resources', 'AiSkillResources', {
    id: 'skill',
    api: async (path) => {
      calls.push(path);
      if (path.endsWith('/resources'))
        return {
          files: [
            { path: 'SKILL.md', text: true },
            { path: 'other.md', text: true },
          ],
        };
      if (path.includes('other.md')) throw Error('读取失败');
      return { text: 'first page', nextOffset: 65536 };
    },
  });
  assert.match(ui.get('dialog').textContent, /加载更多/);
  await act(async () => {
    ui.get('select').value = 'other.md';
    ui.get('select').dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.match(ui.get('[role=alert]').textContent, /读取失败/);
  assert.equal(ui.get('textarea').value, '');
  assert.doesNotMatch(ui.get('dialog').textContent, /加载更多/);
  assert.ok(calls.at(-1).includes('offset=0'));
});
