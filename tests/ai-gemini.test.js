import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AiProvider } from '../server/terminal/ai/provider.js';
test('Gemini native tools retain exact thought signatures, hide thoughts and send paired function results', async (t) => {
  let calls = 0;
  const s = http.createServer((req, res) => {
    if (req.url !== '/v1beta/models/gemini-fixture:generateContent') {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    assert.equal(req.headers['x-goog-api-key'], 'fixture-key');
    assert.equal(req.url, '/v1beta/models/gemini-fixture:generateContent');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const b = JSON.parse(raw);
      assert.equal(b.tools[0].functionDeclarations[0].name, 'run_ssh_command');
      if (calls++) {
        assert.equal(b.contents[1].parts[0].thoughtSignature, 'signature-opaque');
        assert.equal(b.contents[2].parts[0].functionResponse.response.output, 'ok');
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                role: 'model',
                parts: [
                  { thought: true, text: 'private', thoughtSignature: 'signature-opaque' },
                  {
                    functionCall: {
                      name: 'run_ssh_command',
                      args: { command: 'pwd', explanation: '目录' },
                    },
                  },
                  { text: '最终回答' },
                ],
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  const settings = {
    protocol: 'gemini',
    baseUrl: `http://127.0.0.1:${s.address().port}/v1beta`,
    model: 'gemini-fixture',
    apiKey: 'fixture-key',
  };
  const text = [],
    p = new AiProvider(),
    options = { signal: new AbortController().signal, onText: (t) => text.push(t) };
  const turn = await p.complete(settings, [{ role: 'user', content: '检查' }], options);
  assert.equal(turn.content, '最终回答');
  assert.equal(text.join(''), '最终回答');
  assert.equal(turn.toolCalls[0].command, 'pwd');
  await p.complete(
    settings,
    [
      { role: 'user', content: '检查' },
      turn.protocolMessage,
      { role: 'tool', tool_call_id: turn.toolCalls[0].id, content: 'ok' },
    ],
    { ...options, onText: () => {} },
  );
});

test('Gemini model discovery follows pagination and excludes embedding-only models', async (t) => {
  const s = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url.includes('pageToken=next')
          ? {
              models: [
                { name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] },
              ],
            }
          : {
              models: [
                { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
              ],
              nextPageToken: 'next',
            },
      ),
    );
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => s.close(r)));
  assert.deepEqual(
    await new AiProvider().models({
      protocol: 'gemini',
      baseUrl: `http://127.0.0.1:${s.address().port}/v1beta`,
      apiKey: 'key',
    }),
    ['gemini-a', 'gemini-b'],
  );
});
