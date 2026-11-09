import {
  parseAiCall,
  splitAiCalls,
  protocolAiCalls,
  type AiParsedCall,
  type AiFunctionTool,
} from './tools.js';
import { attachmentText, imageAttachments } from './attachment-content.js';
import { createVisibleAiText } from './visible-text.js';
import { randomUUID } from 'node:crypto';
import type { AiSettings, AiProtocolMessage, AiTurn } from '../../domain/ai.js';
import { inputRecord } from '../../errors.js';
import { fail } from '../model.js';
function url(settings: AiSettings, endpoint: string) {
  return settings.protocol === 'ollama'
    ? settings.baseUrl.replace(/\/api$/, '') + '/api/' + endpoint
    : settings.baseUrl + '/' + endpoint;
}
async function request(
  settings: AiSettings,
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url(settings, endpoint), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        ...(settings.protocol === 'claude'
          ? {
              'anthropic-version': '2023-06-01',
              ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
            }
          : settings.apiKey
            ? { Authorization: 'Bearer ' + settings.apiKey }
            : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok || !response.body) throw Error();
    reader = response.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1048576) throw Error();
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
function claudeMessages(messages: AiProtocolMessage[]) {
  const result: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    let role: 'user' | 'assistant', content: unknown[];
    if (m.role === 'tool') {
      role = 'user';
      content = [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }];
    } else if (m.role === 'assistant') {
      role = 'assistant';
      content = [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...(m.tool_calls || []).map((c) => ({
          type: 'tool_use',
          id: c.id,
          name: c.function.name,
          input: JSON.parse(c.function.arguments),
        })),
      ];
    } else {
      role = 'user';
      const text = attachmentText(m);
      content = [
        ...(text ? [{ type: 'text', text }] : []),
        ...imageAttachments(m).map((a) => ({
          type: 'image',
          source: { type: 'base64', media_type: a.mimeType, data: a.data },
        })),
      ];
    }
    if (!content.length) continue;
    const prior = result.at(-1);
    if (prior?.role === role) prior.content.push(...content);
    else result.push({ role, content });
  }
  return result;
}
function ollamaMessages(messages: AiProtocolMessage[]) {
  const names = new Map(
    messages.flatMap((m) =>
      m.role === 'assistant'
        ? (m.tool_calls || []).map((c) => [c.id, c.function.name] as const)
        : [],
    ),
  );
  return messages.map((m) =>
    m.role === 'tool'
      ? {
          role: 'tool',
          tool_name: names.get(m.tool_call_id) || 'run_ssh_command',
          content: m.content,
        }
      : m.role === 'assistant'
        ? {
            role: 'assistant',
            content: m.content || '',
            ...(m.tool_calls
              ? {
                  tool_calls: m.tool_calls.map((c) => ({
                    function: {
                      name: c.function.name,
                      arguments: JSON.parse(c.function.arguments),
                    },
                  })),
                }
              : {}),
          }
        : m.role === 'user'
          ? {
              role: 'user',
              content: attachmentText(m),
              ...(imageAttachments(m).length
                ? { images: imageAttachments(m).map((a) => a.data) }
                : {}),
            }
          : { role: m.role, content: m.content },
  );
}
export async function completeNativeAi(
  settings: AiSettings,
  messages: AiProtocolMessage[],
  tools: readonly AiFunctionTool[],
  { signal, onText }: { signal: AbortSignal; onText: (text: string) => void },
): Promise<AiTurn> {
  try {
    const claude = settings.protocol === 'claude';
    const body = claude
      ? {
          model: settings.model,
          max_tokens: 8192,
          stream: false,
          system: messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join('\n'),
          messages: claudeMessages(messages),
          tools: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters,
          })),
        }
      : {
          model: settings.model,
          stream: false,
          messages: ollamaMessages(messages),
          tools,
        };
    const raw = inputRecord(await request(settings, claude ? 'messages' : 'chat', body, signal));
    let content = '',
      calls: AiParsedCall[] = [];
    if (claude) {
      if (!Array.isArray(raw.content) || raw.stop_reason === 'max_tokens') throw Error();
      for (const value of raw.content) {
        const block = inputRecord(value);
        if (block.type === 'text') {
          if (typeof block.text !== 'string') throw Error();
          content += block.text;
        } else if (block.type === 'tool_use')
          calls.push(parseAiCall(block.id, block.name, block.input));
        else if (block.type !== 'thinking' && block.type !== 'redacted_thinking') throw Error();
      }
    } else {
      if (raw.done !== true) throw Error();
      const m = inputRecord(raw.message);
      if (m.content !== undefined && typeof m.content !== 'string') throw Error();
      content = (m.content as string) || '';
      if (m.tool_calls !== undefined) {
        if (!Array.isArray(m.tool_calls)) throw Error();
        calls = m.tool_calls.map((c) => {
          const f = inputRecord(inputRecord(c).function);
          return parseAiCall(randomUUID(), f.name, f.arguments);
        });
      }
    }
    if (
      calls.length > 10 ||
      new Set(calls.map((c) => c.id)).size !== calls.length ||
      Buffer.byteLength(content + JSON.stringify(calls)) > 131072 ||
      (!content.trim() && !calls.length)
    )
      throw Error();
    if (signal.aborted) throw Error();
    const rawContent = content;
    content = '';
    const visible = createVisibleAiText((text) => {
      content += text;
    });
    visible.push(rawContent);
    visible.finish();
    onText(content);
    return {
      content,
      ...splitAiCalls(calls),
      protocolMessage: {
        role: 'assistant',
        content: rawContent || null,
        ...(calls.length ? { tool_calls: protocolAiCalls(calls) } : {}),
      },
    };
  } catch {
    if (signal.aborted) throw fail('AI 请求已取消', 409);
    throw fail('AI 接口请求失败或响应不符合工具调用协议，请检查地址、模型及连接', 502);
  }
}
export async function nativeModels(settings: AiSettings): Promise<string[]> {
  try {
    const raw = inputRecord(
      await request(settings, settings.protocol === 'claude' ? 'models' : 'tags'),
    );
    const list = settings.protocol === 'claude' ? raw.data : raw.models;
    if (!Array.isArray(list) || list.length > 10000) throw Error();
    return [
      ...new Set(
        list.map((value) => {
          const row = inputRecord(value);
          const id = settings.protocol === 'claude' ? row.id : row.name;
          if (typeof id !== 'string' || !id.trim() || id.length > 200) throw Error();
          return id;
        }),
      ),
    ];
  } catch {
    throw fail('读取模型列表失败，可继续使用已配置模型', 502);
  }
}
