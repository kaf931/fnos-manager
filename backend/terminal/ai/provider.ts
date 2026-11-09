import {
  AI_TOOLS,
  parseAiCall,
  splitAiCalls,
  protocolAiCalls,
  type AiParsedCall,
} from './tools.js';
import { ensureImageInput, openAiUserContent } from './attachment-content.js';
import { completeGemini, geminiModels } from './gemini.js';
import type { AiProviderContract, AiSettings, AiProtocolMessage, AiTurn } from '../../domain/ai.js';
import { inputRecord } from '../../errors.js';
import { fail } from '../model.js';
export { validateAiCommand } from './command.js';
import { createVisibleAiText } from './visible-text.js';
import { completeNativeAi, nativeModels } from './native-protocols.js';
interface PendingTool {
  id: string;
  name: string;
  arguments: string;
}
export class AiProvider implements AiProviderContract {
  async models(settings: AiSettings): Promise<string[]> {
    if (settings.protocol === 'gemini') return geminiModels(settings);
    if (settings.protocol === 'claude' || settings.protocol === 'ollama')
      return nativeModels(settings);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(settings.baseUrl + '/models', {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: settings.apiKey ? { Authorization: 'Bearer ' + settings.apiKey } : {},
      });
      if (!response.ok || !response.body) throw Error();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1048576) throw Error();
        chunks.push(chunk.value);
      }
      const data = inputRecord(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data;
      if (!Array.isArray(data) || data.length > 10000) throw Error();
      const ids = data.map((item: unknown) => {
        const id = inputRecord(item).id;
        if (typeof id !== 'string' || !id.trim() || id.length > 200) throw Error();
        return id;
      });
      return [...new Set(ids)];
    } catch {
      throw fail('读取模型列表失败，可继续使用已配置模型', 502);
    } finally {
      await reader?.cancel().catch(() => {});
    }
  }
  async complete(
    settings: AiSettings,
    messages: AiProtocolMessage[],
    { signal, onText }: { signal: AbortSignal; onText: (text: string) => void },
  ): Promise<AiTurn> {
    ensureImageInput(settings, messages);
    if (settings.protocol === 'gemini')
      return completeGemini(settings, messages, AI_TOOLS, { signal, onText });
    if (settings.protocol === 'claude' || settings.protocol === 'ollama')
      return completeNativeAi(settings, messages, AI_TOOLS, { signal, onText });
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 60000);
    timer.unref?.();
    const pending = new Map<number, PendingTool>(),
      reasoningDetails: unknown[] = [];
    let content = '',
      rawContent = '',
      reasoningContent = '',
      replyBytes = 0,
      done = false,
      finished = false,
      truncated = false;
    const visible = createVisibleAiText((text) => {
      content += text;
      onText(text);
    });
    const addText = (value: unknown) => {
      if (value === null || value === undefined) return;
      if (typeof value !== 'string') throw Error();
      replyBytes += Buffer.byteLength(value);
      if (replyBytes > 131072) throw Error();
      rawContent += value;
      visible.push(value);
    };
    const append = (raw: unknown, streaming: boolean) => {
      if (raw === undefined) return;
      if (!Array.isArray(raw) || raw.length > 10) throw Error();
      for (let i = 0; i < raw.length; i++) {
        const call = inputRecord(raw[i]);
        const index = streaming ? call.index : i;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 10)
          throw Error();
        if (call.type !== undefined && call.type !== 'function') throw Error();
        const target = pending.get(index) || { id: '', name: '', arguments: '' };
        const f = call.function === undefined ? {} : inputRecord(call.function);
        if (call.id !== undefined) {
          if (typeof call.id !== 'string' || call.id.length > 200) throw Error();
          if (target.id && target.id !== call.id) throw Error();
          target.id = call.id;
        }
        for (const key of ['name', 'arguments'] as const)
          if (f[key] !== undefined) {
            if (typeof f[key] !== 'string') throw Error();
            target[key] += f[key];
            replyBytes += Buffer.byteLength(f[key]);
          }
        if (replyBytes > 131072 || target.name.length > 100) throw Error();
        pending.set(index, target);
      }
    };
    const message = (raw: unknown, streaming: boolean) => {
      const m = inputRecord(raw);
      addText(m.content);
      if (m.reasoning_content !== undefined && m.reasoning_content !== null) {
        if (typeof m.reasoning_content !== 'string') throw Error();
        reasoningContent += m.reasoning_content;
        replyBytes += Buffer.byteLength(m.reasoning_content);
      }
      if (m.reasoning_details !== undefined) {
        if (!Array.isArray(m.reasoning_details)) throw Error();
        reasoningDetails.push(...m.reasoning_details);
        replyBytes += Buffer.byteLength(JSON.stringify(m.reasoning_details));
      }
      if (replyBytes > 131072) throw Error();
      append(m.tool_calls, streaming);
    };
    const event = (raw: string) => {
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      if (data === '[DONE]') {
        done = true;
        return;
      }
      if (done) throw Error();
      const parsed = inputRecord(JSON.parse(data));
      if (!Array.isArray(parsed.choices)) throw Error();
      if (!parsed.choices.length) return;
      const choice = inputRecord(parsed.choices[0]);
      if (choice.finish_reason) {
        finished = ['stop', 'tool_calls', 'function_call'].includes(String(choice.finish_reason));
        truncated ||= !finished;
      }
      message(choice.delta || {}, true);
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(settings.baseUrl + '/chat/completions', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout.signal]),
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: 'Bearer ' + settings.apiKey } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          messages: messages.map((m) => {
            if (m.role === 'user') return { role: 'user', content: openAiUserContent(m) };
            if (m.role !== 'assistant') return m;
            const { provider_content: _, ...message } = m;
            return message;
          }),
          tools: AI_TOOLS,
          tool_choice: 'auto',
          stream: true,
          ...(settings.protocol === 'minimax' ||
          /(^|\.)api\.minimax(?:\.cn|\.io|i\.com)$/.test(new URL(settings.baseUrl).hostname)
            ? { reasoning_split: true }
            : {}),
        }),
      });
      if (!response.ok || !response.body) throw Error();
      const streaming = response.headers.get('content-type')?.includes('text/event-stream');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '',
        bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1048576) throw Error();
        buffer += decoder.decode(chunk.value, { stream: true });
        if (streaming) {
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            event(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
          }
          if (Buffer.byteLength(buffer) > 131072) throw Error();
        }
      }
      buffer += decoder.decode();
      if (streaming) {
        if (buffer.trim()) event(buffer);
        if ((!done && !finished) || truncated) throw Error();
      } else {
        const parsed = inputRecord(JSON.parse(buffer));
        if (!Array.isArray(parsed.choices) || !parsed.choices.length) throw Error();
        const choice = inputRecord(parsed.choices[0]);
        if (
          choice.finish_reason &&
          !['stop', 'tool_calls', 'function_call'].includes(String(choice.finish_reason))
        )
          throw Error();
        message(choice.message, false);
      }
      visible.finish();
      const calls: AiParsedCall[] = [];
      const ids = new Set<string>();
      for (const [, p] of [...pending].sort(([a], [b]) => a - b)) {
        if (ids.has(p.id)) throw Error();
        ids.add(p.id);
        calls.push(parseAiCall(p.id, p.name, JSON.parse(p.arguments)));
      }
      if (!content.trim() && !calls.length) throw Error();
      return {
        content,
        ...splitAiCalls(calls),
        protocolMessage: {
          role: 'assistant',
          content: rawContent || null,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}),
          ...(calls.length ? { tool_calls: protocolAiCalls(calls) } : {}),
        },
      };
    } catch {
      if (signal.aborted) throw fail('AI 请求已取消', 409);
      if (timeout.signal.aborted) throw fail('AI 请求超时，请重试', 504);
      throw fail('AI 接口请求失败或响应不符合工具调用协议，请检查地址、模型及连接', 502);
    } finally {
      clearTimeout(timer);
      await reader?.cancel().catch(() => {});
    }
  }
}
