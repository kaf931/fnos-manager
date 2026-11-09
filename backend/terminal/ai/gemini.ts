import {
  parseAiCall,
  splitAiCalls,
  protocolAiCalls,
  type AiParsedCall,
  type AiFunctionTool,
} from './tools.js';
import { attachmentText, imageAttachments } from './attachment-content.js';
import { randomUUID } from 'node:crypto';
import type { AiProtocolMessage, AiSettings, AiTurn } from '../../domain/ai.js';
import { inputRecord } from '../../errors.js';
import { fail } from '../model.js';
async function request(
  settings: AiSettings,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(settings.baseUrl + '/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { 'x-goog-api-key': settings.apiKey } : {}),
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
    return inputRecord(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
    );
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
function contents(messages: AiProtocolMessage[]) {
  const result: { role: 'user' | 'model'; parts: unknown[] }[] = [],
    calls = new Map<string, { name: string; id?: string }>();
  for (const message of messages) {
    if (message.role === 'system') continue;
    let role: 'user' | 'model' = 'user',
      parts: unknown[];
    if (message.role === 'assistant') {
      role = 'model';
      const original =
        message.provider_content?.protocol === 'gemini'
          ? inputRecord(message.provider_content.content)
          : null;
      const originals = original && Array.isArray(original.parts) ? original.parts : [];
      let index = 0;
      const functions = originals.map((p) => inputRecord(p).functionCall).filter(Boolean);
      for (const call of message.tool_calls || []) {
        const raw = functions[index++] ? inputRecord(functions[index - 1]) : null;
        calls.set(call.id, {
          name: call.function.name,
          ...(raw && typeof raw.id === 'string' ? { id: raw.id } : {}),
        });
      }
      parts = originals.length
        ? originals
        : [
            ...(message.content ? [{ text: message.content }] : []),
            ...(message.tool_calls || []).map((c) => ({
              functionCall: { name: c.function.name, args: JSON.parse(c.function.arguments) },
            })),
          ];
    } else if (message.role === 'tool') {
      const call = calls.get(message.tool_call_id);
      if (!call) throw Error();
      parts = [
        {
          functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response: { output: message.content },
          },
        },
      ];
    } else {
      const text = attachmentText(message);
      parts = [
        ...(text ? [{ text }] : []),
        ...imageAttachments(message).map((a) => ({
          inlineData: { mimeType: a.mimeType, data: a.data },
        })),
      ];
    }
    if (!parts.length) continue;
    const previous = result.at(-1);
    if (previous?.role === role) previous.parts.push(...parts);
    else result.push({ role, parts });
  }
  return result;
}
export async function completeGemini(
  settings: AiSettings,
  messages: AiProtocolMessage[],
  tools: readonly AiFunctionTool[],
  { signal, onText }: { signal: AbortSignal; onText: (text: string) => void },
): Promise<AiTurn> {
  try {
    const model = settings.model.replace(/^models\//, '');
    const raw = await request(
      settings,
      'models/' + encodeURIComponent(model) + ':generateContent',
      {
        contents: contents(messages),
        systemInstruction: {
          parts: messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content })),
        },
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.function.name,
              description: tool.function.description,
              parametersJsonSchema: tool.function.parameters,
            })),
          },
        ],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      },
      signal,
    );
    if (!Array.isArray(raw.candidates) || !raw.candidates.length) throw Error();
    const candidate = inputRecord(raw.candidates[0]);
    if (candidate.finishReason !== 'STOP') throw Error();
    const original = inputRecord(candidate.content);
    if (
      !Array.isArray(original.parts) ||
      original.parts.length > 100 ||
      Buffer.byteLength(JSON.stringify(original)) > 131072
    )
      throw Error();
    let content = '';
    const toolCalls: AiParsedCall[] = [];
    for (const item of original.parts) {
      const part = inputRecord(item);
      if (part.functionCall) {
        const call = inputRecord(part.functionCall);
        const id = typeof call.id === 'string' ? call.id : randomUUID();
        toolCalls.push(parseAiCall(id, call.name, call.args));
      } else if (part.text !== undefined) {
        if (typeof part.text !== 'string') throw Error();
        if (part.thought !== true) content += part.text;
      } else if (!part.thoughtSignature) throw Error();
    }
    if (
      toolCalls.length > 10 ||
      new Set(toolCalls.map((c) => c.id)).size !== toolCalls.length ||
      (!content.trim() && !toolCalls.length)
    )
      throw Error();
    if (signal.aborted) throw Error();
    onText(content);
    return {
      content,
      ...splitAiCalls(toolCalls),
      protocolMessage: {
        role: 'assistant',
        content: content || null,
        provider_content: { protocol: 'gemini', content: original },
        ...(toolCalls.length ? { tool_calls: protocolAiCalls(toolCalls) } : {}),
      },
    };
  } catch {
    if (signal.aborted) throw fail('AI 请求已取消', 409);
    throw fail('Gemini 接口请求失败或工具调用响应无效，请检查地址、模型及连接', 502);
  }
}
export async function geminiModels(settings: AiSettings): Promise<string[]> {
  try {
    let token = '',
      pages = 0;
    const models: string[] = [];
    do {
      const raw = await request(
        settings,
        'models?pageSize=1000' + (token ? '&pageToken=' + encodeURIComponent(token) : ''),
      );
      if (!Array.isArray(raw.models) || raw.models.length > 1000) throw Error();
      for (const value of raw.models) {
        const m = inputRecord(value);
        if (
          Array.isArray(m.supportedGenerationMethods) &&
          !m.supportedGenerationMethods.includes('generateContent')
        )
          continue;
        if (typeof m.name !== 'string' || !/^models\/[\w.:-]+$/.test(m.name) || m.name.length > 207)
          throw Error();
        models.push(m.name.slice(7));
      }
      if (raw.nextPageToken !== undefined && typeof raw.nextPageToken !== 'string') throw Error();
      token = String(raw.nextPageToken || '');
      if (token.length > 4096) throw Error();
    } while (token && ++pages < 10);
    if (token) throw Error();
    return [...new Set(models)];
  } catch {
    throw fail('读取 Gemini 模型列表失败，可继续使用已配置模型', 502);
  }
}
