import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AiProvider } from '../server/terminal/ai/provider.js';
async function fixture(t, handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  return {
    baseUrl: `http://127.0.0.1:${s.address().port}/v1`,
    apiKey: 'secret-key',
    model: 'fixture',
    updatedAt: 0,
  };
}
test('provider handles fragmented UTF8 SSE and assembles paired tool arguments', async (t) => {
  const settings = await fixture(t, (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer secret-key');
    res.setHeader('Content-Type', 'text/event-stream');
    const chunks = [
      { content: '检查' },
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'run_ssh_command', arguments: '{"command":"p' },
          },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: 'wd","explanation":"查看目录"}' } }] },
    ];
    const body = Buffer.from(
      chunks
        .map((delta) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\r\n\r\n')
        .join('') + 'data: [DONE]\n\n',
    );
    for (let i = 0; i < body.length; i += 7) res.write(body.subarray(i, i + 7));
    res.end();
  });
  const text = [];
  const turn = await new AiProvider().complete(settings, [{ role: 'user', content: '检查' }], {
    signal: new AbortController().signal,
    onText: (x) => text.push(x),
  });
  assert.equal(turn.content, '检查');
  assert.equal(text.join(''), '检查');
  assert.deepEqual(turn.toolCalls, [{ id: 'call_1', command: 'pwd', explanation: '查看目录' }]);
});
test('provider rejects invalid and oversized tools, HTML errors, and redirects without leaking key', async (t) => {
  let mode = 'bad';
  const settings = await fixture(t, (_, res) => {
    if (mode === 'html') {
      res.writeHead(502);
      return res.end('secret-key');
    }
    if (mode === 'redirect') {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/' });
      return res.end();
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'x',
                  type: 'function',
                  function: {
                    name: mode === 'unknown' ? 'arbitrary' : 'run_ssh_command',
                    arguments: JSON.stringify({
                      command: mode === 'large' ? 'a'.repeat(16385) : 'x\u001b',
                      explanation: 'test',
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  for (mode of ['bad', 'large', 'unknown', 'html', 'redirect'])
    await assert.rejects(
      new AiProvider().complete(settings, [], {
        signal: new AbortController().signal,
        onText: () => {},
      }),
      (e) => !e.message.includes('secret-key'),
    );
});
test('provider supports non-stream JSON responses and caller abort', async (t) => {
  const settings = await fixture(t, (_, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }));
  });
  assert.equal(
    (
      await new AiProvider().complete(settings, [], {
        signal: new AbortController().signal,
        onText: () => {},
      })
    ).content,
    'answer',
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    new AiProvider().complete(settings, [], { signal: c.signal, onText: () => {} }),
  );
});
test('model list uses configured endpoint, deduplicates IDs and rejects malformed responses', async (t) => {
  let bad = false;
  const settings = await fixture(t, (req, res) => {
    assert.equal(req.url, '/v1/models');
    assert.equal(req.headers.authorization, 'Bearer secret-key');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        bad ? { data: [{ id: 4 }] } : { data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] },
      ),
    );
  });
  const p = new AiProvider();
  assert.deepEqual(await p.models(settings), ['a', 'b']);
  bad = true;
  await assert.rejects(p.models(settings), /模型列表/);
});

test('MiniMax finish_reason closes a stream without DONE and hides fragmented thinking', async (t) => {
  const settings = await fixture(t, (_, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    for (const delta of [
      { content: '<thi' },
      { content: 'nk>internal' },
      { content: ' reasoning</th' },
      { content: 'ink>## Answer' },
      { reasoning_content: 'private' },
    ])
      res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
    res.end(
      'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n',
    );
  });
  const text = [];
  const turn = await new AiProvider().complete(settings, [], {
    signal: new AbortController().signal,
    onText: (x) => text.push(x),
  });
  assert.equal(turn.content, '## Answer');
  assert.equal(text.join(''), '## Answer');
  assert.equal(turn.protocolMessage.content, '<think>internal reasoning</think>## Answer');
  assert.equal(turn.protocolMessage.reasoning_content, 'private');
});
test('a truncated stream cannot expose or propose partial commands', async (t) => {
  const settings = await fixture(t, (_, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'incomplete' }, finish_reason: 'length' }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
  });
  await assert.rejects(
    new AiProvider().complete(settings, [], {
      signal: new AbortController().signal,
      onText: () => {},
    }),
  );
});

for (const protocol of ['glm', 'minimax', 'deepseek', 'mimo'])
  test(
    protocol + ' uses documented compatible tools and preserves reasoning context',
    async (t) => {
      let n = 0;
      const settings = await fixture(t, (req, res) => {
        let text = '';
        req.on('data', (c) => (text += c));
        req.on('end', () => {
          const body = JSON.parse(text);
          if (n++) {
            assert.equal(body.messages[0].reasoning_content, 'private');
            assert.equal(body.messages[0].tool_calls[0].id, 'tool-1');
          }
          if (protocol === 'minimax') assert.equal(body.reasoning_split, true);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: '回答',
                    reasoning_content: 'private',
                    tool_calls: [
                      {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                          name: 'run_ssh_command',
                          arguments: JSON.stringify({ command: 'pwd', explanation: '目录' }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }),
          );
        });
      });
      settings.protocol = protocol;
      const provider = new AiProvider(),
        options = { signal: new AbortController().signal, onText: () => {} };
      const first = await provider.complete(settings, [], options);
      assert.equal(first.content, '回答');
      assert.equal(first.toolCalls[0].command, 'pwd');
      await provider.complete(
        settings,
        [first.protocolMessage, { role: 'tool', tool_call_id: 'tool-1', content: 'ok' }],
        options,
      );
    },
  );
