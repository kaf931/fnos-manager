import test from 'node:test';
import assert from 'node:assert/strict';
test('AI activity distinguishes waiting, replying, execution and settled states', async () => {
  const { aiActivity } = await import('../.web-test/terminal-ai-model.js');
  assert.equal(
    aiActivity({ busy: true, messages: [{ role: 'assistant', content: '' }], proposals: [] }),
    '正在思考…',
  );
  assert.equal(
    aiActivity({ busy: true, messages: [{ role: 'assistant', content: 'hello' }], proposals: [] }),
    '',
  );
  assert.equal(
    aiActivity({ busy: true, messages: [], proposals: [{ status: 'running' }] }),
    '正在执行命令…',
  );
  assert.equal(aiActivity({ busy: false, messages: [], proposals: [] }), '');
  assert.equal(aiActivity({ busy: true, error: 'failed', messages: [], proposals: [] }), '');
});
