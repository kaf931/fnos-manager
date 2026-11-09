import type { ClientChannel } from 'ssh2';
import type { TerminalSession } from '../session.js';
import type { AiExecutionResult } from '../../domain/ai.js';
import { validateAiCommand } from './provider.js';
export type AiExecSession = Pick<TerminalSession, 'client' | 'state' | 'closed'>;
export function executeAiCommand(
  session: AiExecSession,
  command: string,
  {
    signal,
    timeoutMs = 30000,
    maxBytes = 65536,
  }: { signal: AbortSignal; timeoutMs?: number; maxBytes?: number },
): Promise<AiExecutionResult> {
  validateAiCommand(command);
  return new Promise((resolve) => {
    let channel: ClientChannel | undefined,
      done = false,
      bytes = 0,
      truncated = false,
      exitCode: number | null = null;
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    const decode = (items: Buffer[]) =>
      new TextDecoder().decode(Buffer.concat(items), { stream: true });
    const terminate = () => {
      try {
        channel?.signal('TERM');
        channel?.close();
      } catch {
        channel?.destroy();
      }
    };
    const finish = (status: AiExecutionResult['status']) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (status !== 'success') terminate();
      resolve({ stdout: decode(stdout), stderr: decode(stderr), exitCode, status, truncated });
    };
    const abort = () => finish('cancelled');
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    timer.unref?.();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      finish('cancelled');
      return;
    }
    if (session.closed || session.state !== 'connected' || !session.client) {
      finish('failed');
      return;
    }
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (done) return;
      const remaining = Math.max(0, maxBytes - bytes);
      target.push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += chunk.length;
      if (bytes > maxBytes) {
        truncated = true;
        finish('failed');
      }
    };
    try {
      session.client.exec(command, (error, stream) => {
        if (done) {
          stream?.close();
          return;
        }
        if (error) {
          finish('failed');
          return;
        }
        channel = stream;
        stream.on('data', (data: Buffer) => collect(stdout, data));
        stream.stderr.on('data', (data: Buffer) => collect(stderr, data));
        stream.on('exit', (code: number | null) => {
          exitCode = typeof code === 'number' ? code : null;
        });
        stream.on('error', () => finish('failed'));
        stream.on('close', () => finish(exitCode === 0 ? 'success' : 'failed'));
      });
    } catch {
      finish('failed');
    }
  });
}
