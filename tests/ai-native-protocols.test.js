import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AiProvider } from '../server/terminal/ai/provider.js';
for (const protocol of ['claude', 'ollama'])
  test(protocol + ' uses native tool protocol and correctly returns tool results', async (t) => {
    const requests = [];
    let malformed = false;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        requests.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET')
          return res.end(
            JSON.stringify(
              protocol === 'claude'
                ? { data: [{ id: 'model-a' }] }
                : { models: [{ name: 'local-a' }] },
            ),
          );
        if (malformed)
          return res.end(
            JSON.stringify(
              protocol === 'claude'
                ? { content: [{ type: 'tool_use', id: 'bad', name: 'unknown', input: {} }] }
                : {
                    message: { tool_calls: [{ function: { name: 'unknown', arguments: {} } }] },
                    done: true,
                  },
            ),
          );
        const nativeCall =
          protocol === 'claude'
            ? {
                content: [
                  { type: 'text', text: '检查' },
                  {
                    type: 'tool_use',
                    id: 'call-1',
                    name: 'run_ssh_command',
                    input: { command: 'pwd', explanation: '目录' },
                  },
                ],
                stop_reason: 'tool_use',
              }
            : {
                message: {
                  content: '检查',
                  tool_calls: [
                    {
                      function: {
                        name: 'run_ssh_command',
                        arguments: { command: 'pwd', explanation: '目录' },
                      },
                    },
                  ],
                },
                done: true,
              };
        res.end(JSON.stringify(nativeCall));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise((r) => server.close(r)));
    const config = {
      protocol,
      baseUrl: `http://127.0.0.1:${server.address().port}` + (protocol === 'claude' ? '/v1' : ''),
      model: 'test',
      apiKey: 'key',
      updatedAt: 0,
    };
    const p = new AiProvider();
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: '检查' },
    ];
    const turn = await p.complete(config, messages, {
      signal: new AbortController().signal,
      onText: () => {},
    });
    assert.equal(turn.toolCalls[0].command, 'pwd');
    assert.equal(requests[0].url, protocol === 'claude' ? '/v1/messages' : '/api/chat');
    if (protocol === 'claude') {
      assert.equal(requests[0].headers['x-api-key'], 'key');
      assert.equal(requests[0].headers['anthropic-version'], '2023-06-01');
      assert.equal(requests[0].body.system, 'system');
    } else assert.equal(requests[0].headers.authorization, 'Bearer key');
    messages.push(
      {
        role: 'assistant',
        content: turn.content,
        tool_calls: [
          {
            id: turn.toolCalls[0].id,
            type: 'function',
            function: {
              name: 'run_ssh_command',
              arguments: JSON.stringify({ command: 'pwd', explanation: '目录' }),
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: turn.toolCalls[0].id, content: 'output' },
    );
    await p.complete(config, messages, { signal: new AbortController().signal, onText: () => {} });
    const last = requests.at(-1).body.messages.at(-1);
    assert.equal(
      protocol === 'claude' ? last.content[0].tool_use_id : last.tool_name,
      protocol === 'claude' ? turn.toolCalls[0].id : 'run_ssh_command',
    );
    assert.deepEqual(await p.models(config), [protocol === 'claude' ? 'model-a' : 'local-a']);
    malformed = true;
    await assert.rejects(
      p.complete(config, messages, { signal: new AbortController().signal, onText: () => {} }),
      /AI 接口/,
    );
  });
