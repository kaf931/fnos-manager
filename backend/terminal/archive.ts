import { readFileSync } from 'node:fs';
import type { ClientChannel } from 'ssh2';
import type { ArchiveRequest, ArchiveResult } from '../domain/terminal-files.js';
import { inputRecord } from '../errors.js';
import type { SessionFiles } from './files.js';
import { fail } from './model.js';
const worker = readFileSync(new URL('./archive-worker.py', import.meta.url), 'utf8'),
  quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
export const archiveCommand = (request: ArchiveRequest) =>
  'python3 -c ' + quote(worker) + ' ' + Buffer.from(JSON.stringify(request)).toString('base64');
export function runArchive(files: SessionFiles, request: ArchiveRequest) {
  files.check();
  return new Promise<ArchiveResult>((resolve, reject) => {
    let stream: ClientChannel | undefined;
    let done = false,
      bytes = 0,
      out = '';
    const finish = (error: unknown, result?: ArchiveResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      files.jobs.delete(cancel);
      if (error) {
        try {
          stream?.signal('TERM');
          stream?.close();
        } catch {}
        reject(error);
      } else if (result) resolve(result);
    };
    const cancel = (e: Error) => finish(e);
    const timer = setTimeout(() => finish(fail('压缩操作超时，请检查目标目录', 504)), 125000);
    timer.unref?.();
    files.jobs.add(cancel);
    try {
      files.client.exec(archiveCommand(request), (error, channel) => {
        if (done) {
          channel?.close();
          return;
        }
        if (error) return finish(fail('无法启动压缩操作，请确认目标已安装 Python 3'));
        stream = files.track(channel);
        const count = (data: Buffer) => {
          bytes += data.length;
          if (bytes > 131072) finish(fail('压缩操作响应超过上限'));
        };
        channel.on('data', (data: Buffer) => {
          count(data);
          if (!done) out += data.toString();
        });
        channel.stderr?.on('data', count);
        channel.on('error', () => finish(fail('压缩连接已中断')));
        channel.on('close', (code: number) => {
          if (done) return;
          try {
            const result = inputRecord(JSON.parse(out));
            if (typeof result.error === 'string') finish(fail(result.error));
            else if (code !== 0) finish(fail('压缩操作失败'));
            else if (typeof result.mode === 'number') finish(null, { mode: result.mode });
            else if (typeof result.name === 'string' && typeof result.entries === 'number')
              finish(null, { name: result.name, entries: result.entries });
            else finish(fail('压缩操作响应格式无效'));
          } catch {
            finish(fail('无法执行压缩操作，请确认目标已安装 Python 3'));
          }
        });
        channel.end();
      });
    } catch {
      finish(fail('无法启动压缩操作'));
    }
  });
}
