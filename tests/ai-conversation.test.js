import test from 'node:test';
import assert from 'node:assert/strict';
import { AiConversationService } from '../server/terminal/ai/conversation.js';
const settings = {
  privateSettings: () => ({
    baseUrl: 'http://mock/v1',
    model: 'fixture',
    apiKey: 'key-not-in-context',
    updatedAt: 0,
  }),
};
async function idle(service, owner = 'a', session = 's') {
  for (let i = 0; i < 100; i++) {
    if (!service.snapshot(owner, session).busy) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('busy timeout');
}
function fixture(provider, execute) {
  const calls = [];
  const service = new AiConversationService({
    settings,
    provider,
    getSession: (owner, id) => {
      if (owner !== 'a' || id !== 's') throw Error('not owned');
      return { client: null, state: 'connected', closed: false };
    },
    execute:
      execute ||
      (async (_s, cmd) => {
        calls.push(cmd);
        return { stdout: 'output', stderr: '', status: 'success', exitCode: 0, truncated: false };
      }),
  });
  return { service, calls };
}
test('AI only proposes until confirmation; execution is once, bound to session, returns paired tool output', async () => {
  let requests = 0;
  const f = fixture({
    complete: async (_settings, messages) => {
      assert.ok(!JSON.stringify(messages).includes('key-not-in-context'));
      if (requests++ === 0)
        return {
          content: '目的',
          toolCalls: [{ id: 'call', command: 'pwd', explanation: '看目录' }],
        };
      assert.equal(messages.at(-1).tool_call_id, 'call');
      return { content: '总结', toolCalls: [] };
    },
  });
  f.service.message('a', 's', '检查');
  await idle(f.service);
  assert.deepEqual(f.calls, []);
  const p = f.service.snapshot('a', 's').proposals[0];
  assert.throws(() => f.service.execute('b', 's', p.proposalId));
  assert.throws(() => f.service.execute('a', 'other', p.proposalId));
  f.service.execute('a', 's', p.proposalId);
  assert.throws(() => f.service.execute('a', 's', p.proposalId));
  await idle(f.service);
  assert.deepEqual(f.calls, ['pwd']);
  assert.equal(f.service.snapshot('a', 's').messages.at(-1).content, '总结');
  await f.service.close();
});
test('multi-tool rejection pairs results; cancellation and session close expire proposals and late replies', async () => {
  let count = 0;
  const f = fixture({
    complete: async () =>
      count++
        ? { content: '完成', toolCalls: [] }
        : {
            content: '',
            toolCalls: [
              { id: '1', command: 'pwd', explanation: '一' },
              { id: '2', command: 'whoami', explanation: '二' },
            ],
          },
  });
  f.service.message('a', 's', '检查');
  await idle(f.service);
  let ps = f.service.snapshot('a', 's').proposals;
  f.service.reject('a', 's', ps[0].proposalId);
  await idle(f.service);
  assert.equal(count, 1);
  f.service.reject('a', 's', ps[1].proposalId);
  await idle(f.service);
  assert.equal(count, 2);
  assert.equal(f.calls.length, 0);
  await f.service.close();
  let release;
  const slow = fixture({ complete: () => new Promise((r) => (release = r)) });
  slow.service.message('a', 's', '慢请求');
  slow.service.clearSession('s');
  release({ content: 'late', toolCalls: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(slow.service.snapshot('a', 's').messages.length, 0);
  await slow.service.close();
});
test('AI rejects concurrent turns and limits user question to ten tool rounds', async () => {
  let n = 0;
  const f = fixture({
    complete: async () => ({
      content: '',
      toolCalls: [{ id: String(++n), command: 'pwd', explanation: 'step' }],
    }),
  });
  f.service.message('a', 's', '检查');
  assert.throws(() => f.service.message('a', 's', 'repeat'));
  await idle(f.service);
  for (let i = 0; i < 10; i++) {
    const pending = f.service.snapshot('a', 's').proposals.find((x) => x.status === 'pending');
    assert.ok(pending);
    f.service.execute('a', 's', pending.proposalId);
    await idle(f.service);
  }
  assert.equal(f.calls.length, 10);
  assert.equal(
    f.service.snapshot('a', 's').proposals.filter((x) => x.status === 'pending').length,
    0,
  );
  await f.service.close();
});
test('selected model applies only to the current question and its tool continuation', async () => {
  const seen = [];
  const f = fixture({
    complete: async (config) => {
      seen.push(config.model);
      return { content: '完成', toolCalls: [] };
    },
  });
  f.service.message('a', 's', '检查', { model: 'other-model' });
  await idle(f.service);
  assert.deepEqual(seen, ['other-model']);
  assert.equal(settings.privateSettings().model, 'fixture');
  assert.throws(() => f.service.message('a', 's', '检查', { model: ' ' }));
  await f.service.close();
});
test('silent permission is explicit per question, executes sequentially and defaults back to review', async () => {
  let n = 0;
  const f = fixture({
    complete: async () =>
      ++n % 2
        ? {
            content: '检查',
            toolCalls: [
              { id: 'x' + n, command: 'pwd', explanation: '目录' },
              { id: 'y' + n, command: 'whoami', explanation: '身份' },
            ],
          }
        : { content: '完成', toolCalls: [] },
  });
  f.service.message('a', 's', '检查', { executionMode: 'silent' });
  await idle(f.service);
  assert.deepEqual(f.calls, ['pwd', 'whoami']);
  assert.equal(
    f.service.snapshot('a', 's').proposals.every((p) => p.status === 'completed'),
    true,
  );
  f.service.message('a', 's', '再检查');
  await idle(f.service);
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.snapshot('a', 's').executionMode, 'review');
  f.service.cancel('a', 's');
  assert.throws(() => f.service.message('a', 's', '检查', { executionMode: 'invalid' }));
  await f.service.close();
});
test('cancel stops a silent batch before the next command and expires remaining proposals', async () => {
  let release;
  const calls = [];
  const f = fixture(
    {
      complete: async () => ({
        content: '',
        toolCalls: [
          { id: '1', command: 'one', explanation: '一' },
          { id: '2', command: 'two', explanation: '二' },
        ],
      }),
    },
    async (_s, command) => {
      calls.push(command);
      return new Promise((r) => (release = r));
    },
  );
  f.service.message('a', 's', '执行', { executionMode: 'silent' });
  for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 1));
  assert.ok(release);
  f.service.cancel('a', 's');
  release({ stdout: '', stderr: '', exitCode: 0, status: 'success', truncated: false });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['one']);
  assert.ok(f.service.snapshot('a', 's').proposals.every((p) => p.status === 'expired'));
  await f.service.close();
});

test('progress tracks streaming, review, execution and completion with stable elapsed endpoints', async () => {
  let release,
    onText,
    calls = 0,
    finishExecution;
  const f = fixture(
    {
      complete: async (_settings, _messages, options) => {
        if (calls++) return { content: '总结', toolCalls: [] };
        onText = options.onText;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    () =>
      new Promise((resolve) => {
        finishExecution = resolve;
      }),
  );
  f.service.message('a', 's', '检查');
  let snapshot = f.service.snapshot('a', 's');
  assert.equal(snapshot.progress.steps.at(-1).phase, 'thinking');
  assert.equal(snapshot.progress.finishedAt, undefined);
  onText('准备');
  onText('执行');
  snapshot = f.service.snapshot('a', 's');
  assert.equal(snapshot.progress.steps.at(-1).phase, 'responding');
  assert.equal(snapshot.progress.steps.filter((step) => step.phase === 'responding').length, 1);
  release({ content: '准备执行', toolCalls: [{ id: 'p', command: 'pwd', explanation: '目录' }] });
  await idle(f.service);
  snapshot = f.service.snapshot('a', 's');
  assert.equal(snapshot.progress.steps.at(-1).phase, 'review');
  assert.ok(snapshot.progress.finishedAt >= snapshot.progress.startedAt);
  f.service.execute('a', 's', snapshot.proposals[0].proposalId);
  snapshot = f.service.snapshot('a', 's');
  assert.equal(snapshot.progress.steps.at(-1).phase, 'executing');
  assert.equal(snapshot.progress.finishedAt, undefined);
  finishExecution({ stdout: '/', stderr: '', status: 'success', exitCode: 0, truncated: false });
  await idle(f.service);
  snapshot = f.service.snapshot('a', 's');
  assert.equal(snapshot.progress.steps.at(-1).phase, 'completed');
  assert.ok(snapshot.progress.steps.every((step) => step.finishedAt >= step.startedAt));
  assert.equal(snapshot.progress.finishedAt, snapshot.progress.steps.at(-1).finishedAt);
  assert.equal(snapshot.messages.at(-1).content, '总结');
  await f.service.close();
});

test('cancel records a terminal progress step, aborts provider and ignores late progress; next turn resets steps', async () => {
  let release,
    onText,
    signal,
    count = 0;
  const f = fixture({
    complete: async (_config, _messages, options) => {
      if (count++) return { content: '新的回复', toolCalls: [] };
      onText = options.onText;
      signal = options.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  f.service.message('a', 's', '慢请求');
  f.service.cancel('a', 's');
  assert.equal(signal.aborted, true);
  const cancelled = f.service.snapshot('a', 's');
  assert.equal(cancelled.progress.steps.at(-1).phase, 'cancelled');
  assert.equal(cancelled.busy, false);
  onText('late streamed bytes');
  release({ content: 'late completion', toolCalls: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(f.service.snapshot('a', 's').progress, cancelled.progress);
  assert.ok(!JSON.stringify(f.service.snapshot('a', 's')).includes('late completion'));
  f.service.message('a', 's', '新请求');
  await idle(f.service);
  const next = f.service.snapshot('a', 's');
  assert.equal(next.progress.steps.at(-1).phase, 'completed');
  assert.ok(!next.progress.steps.some((step) => step.phase === 'cancelled'));
  await f.service.close();
});

test('provider failure completes progress timing as failed', async () => {
  const f = fixture({
    complete: async () => {
      throw Error('provider failed');
    },
  });
  f.service.message('a', 's', '失败请求');
  await idle(f.service);
  const snapshot = f.service.snapshot('a', 's');
  assert.equal(snapshot.progress.steps.at(-1).phase, 'failed');
  assert.ok(snapshot.progress.finishedAt >= snapshot.progress.startedAt);
  assert.ok(snapshot.error);
  await f.service.close();
});
