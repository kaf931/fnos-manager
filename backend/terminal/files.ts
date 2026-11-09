import { OperationRejected } from '../operations/outcome.js';
import type { OperationService } from '../operations/service.js';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Client, SFTPWrapper } from 'ssh2';
import type { FileListingEntry, SftpOperations } from '../domain/terminal-files.js';
import { errorInfo } from '../errors.js';
import { runArchive } from './archive.js';
import { fail } from './model.js';
export const MAX_UPLOAD = 256 * 1024 * 1024;
export function validateName(name: unknown) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 255 ||
    ['.', '..'].includes(name) ||
    /[\/\x00-\x1f\x7f]/.test(name)
  )
    throw fail('名称不能包含路径分隔符或控制字符');
  return name;
}
export function validPath(p: unknown) {
  if (typeof p !== 'string' || p.length > 4096 || !p.startsWith('/') || /[\x00-\x1f\x7f]/.test(p))
    throw fail('请输入有效绝对路径');
  return path.posix.normalize(p);
}
function remoteError(e: unknown) {
  const details = e && typeof e === 'object' ? (e as { status?: unknown; code?: unknown }) : {};
  if (typeof details.status === 'number' && e instanceof Error) return e;
  // SFTP status replies describe a rejected request; connection/reset errors do not.
  const rejected = [2, 3, 4, 8, 18].includes(details.code as number);
  const error = fail(
    details.code === 2
      ? '文件或目录不存在'
      : details.code === 3
        ? '没有访问该文件或目录的权限'
        : '文件操作失败，请检查权限或重试',
    400,
  );
  return rejected ? new OperationRejected(error.message, error.status) : error;
}
export class SessionFiles {
  private onChannelStatus?: (status: 'running' | 'passed' | 'failed') => void;
  textEncodings = new Map<string, string>();
  textVersions?: {
    capture: (path: string, bytes: Buffer, encoding: string) => unknown | Promise<unknown>;
  };
  audit?: { service: OperationService; owner: string };
  declare jobs: Set<(error: Error) => void>;
  declare streams: Set<Readable | Writable>;
  declare writing: boolean;
  declare readers: number;
  declare listing: boolean;
  declare closed: boolean;
  declare isConnected: () => boolean;
  declare opening: Promise<SFTPWrapper> | null;
  declare channelGeneration: number;
  declare timeoutMs: number;
  declare client: Client;
  declare sftp: SFTPWrapper | null;
  declare calculating: boolean;
  declare scanTimeoutMs: number | undefined;
  declare maxScanEntries: number | undefined;
  declare idleMs: number;

  constructor(
    client: Client,
    {
      isConnected = () => true,
      timeoutMs = 30000,
      idleMs = 60000,
      onChannelStatus,
    }: {
      isConnected?: () => boolean;
      timeoutMs?: number;
      idleMs?: number;
      onChannelStatus?: (status: 'running' | 'passed' | 'failed') => void;
    } = {},
  ) {
    Object.assign(this, { client, isConnected, timeoutMs, idleMs, onChannelStatus });
    this.jobs = new Set();
    this.streams = new Set();
    this.writing = false;
    this.readers = 0;
    this.listing = false;
  }
  check() {
    if (this.closed || !this.isConnected()) throw fail('SSH 连接已断开，请重新连接', 409);
  }
  async channel() {
    this.check();
    if (this.opening) return this.opening;
    this.onChannelStatus?.('running');
    const generation = this.channelGeneration || 0;
    let resolve!: (value: SFTPWrapper) => void;
    let reject!: (reason: unknown) => void;
    this.opening = new Promise<SFTPWrapper>((r, j) => {
      resolve = r;
      reject = j;
    });
    const opening = this.opening;
    let settled = false;
    const finish = (err: unknown, sftp?: SFTPWrapper) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.jobs.delete(cancel);
      this.onChannelStatus?.(err || !sftp ? 'failed' : 'passed');
      if (err) reject(err);
      else if (sftp) resolve(sftp);
      else reject(fail('文件服务不可用'));
    };
    const cancel = (e: Error) => finish(e);
    const timer = setTimeout(() => {
      finish(fail('文件服务连接超时'));
      this.reset();
    }, this.timeoutMs);
    this.jobs.add(cancel);
    try {
      this.client.sftp((err, sftp) => {
        if (this.closed || generation !== (this.channelGeneration || 0)) {
          sftp?.end();
          finish(fail('文件服务已关闭'));
          return;
        }
        if (err) {
          this.opening = null;
          finish(fail('目标未提供可用的 SFTP 文件服务'));
          return;
        }
        this.sftp = sftp;
        const ended = () => {
          if (this.sftp === sftp) this.reset();
        };
        sftp.on('error', ended);
        sftp.on('close', ended);
        finish(null, sftp);
      });
    } catch {
      this.opening = null;
      finish(fail('目标未提供可用的 SFTP 文件服务'));
    }
    return opening;
  }
  reset() {
    this.channelGeneration = (this.channelGeneration || 0) + 1;
    const old = this.sftp;
    this.sftp = null;
    this.opening = null;
    for (const reject of [...this.jobs]) reject(fail('文件服务已关闭或操作超时', 409));
    for (const stream of [...this.streams]) stream.destroy(fail('文件传输已中断'));
    try {
      old?.end();
    } catch {}
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.reset();
  }
  async call<M extends keyof SftpOperations>(
    method: M,
    ...args: SftpOperations[M]['args']
  ): Promise<SftpOperations[M]['result']> {
    return this.perform(await this.channel(), method, args);
  }
  handleCall<M extends keyof SftpOperations>(
    s: SFTPWrapper,
    method: M,
    ...args: SftpOperations[M]['args']
  ): Promise<SftpOperations[M]['result']> {
    this.check();
    if (s !== this.sftp) throw fail('文件服务已重置，请重试', 409);
    return this.perform(s, method, args);
  }
  perform<M extends keyof SftpOperations>(
    s: SFTPWrapper,
    method: M,
    args: SftpOperations[M]['args'],
    timeoutMs = this.timeoutMs,
  ): Promise<SftpOperations[M]['result']> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err: unknown, value?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.jobs.delete(cancel);
        const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
        if (code === 1 && (method === 'readdir' || method === 'read'))
          resolve((method === 'read' ? 0 : false) as SftpOperations[M]['result']);
        else if (err) reject(remoteError(err));
        else resolve(value as SftpOperations[M]['result']);
      };
      const cancel = (error: Error) => finish(error);
      const timer = setTimeout(() => {
        finish(fail('文件操作超时，请重试'));
        this.reset();
      }, timeoutMs);
      this.jobs.add(cancel);
      try {
        // Each operation is described by SftpOperations; ssh2 uses distinct callback overloads.
        // The adapter erases only the varying argument tuple, while preserving caller/result types.
        const invoke = s[method] as unknown as (
          ...values: [...SftpOperations[M]['args'], (error: unknown, result?: unknown) => void]
        ) => void;
        invoke.apply(s, [...args, finish]);
      } catch (error) {
        finish(error);
      }
    });
  }

  async exists(p: string) {
    try {
      await this.call('lstat', p);
      return true;
    } catch (e) {
      if (errorInfo(e).message === '文件或目录不存在') return false;
      throw e;
    }
  }
  target(parent: unknown, name: unknown) {
    return path.posix.join(validPath(parent), validateName(name));
  }
  async list(p: unknown) {
    if (this.listing) throw fail('正在读取目录，请稍候', 409);
    this.listing = true;
    let handle: Buffer | undefined, channel: SFTPWrapper | undefined;
    try {
      const actual = await this.call('realpath', p === undefined ? '.' : validPath(p));
      channel = await this.channel();
      handle = await this.handleCall(channel, 'opendir', actual);
      const entries: FileListingEntry[] = [];
      while (true) {
        const batch = await this.handleCall(channel, 'readdir', handle);
        if (batch === false) break;
        for (const e of batch) {
          if (['.', '..'].includes(e.filename)) continue;
          if (entries.length >= 10000) throw fail('目录超过 10000 项，请访问更小的子目录');
          const a = e.attrs;
          entries.push({
            name: e.filename,
            type: a.isDirectory()
              ? 'directory'
              : a.isSymbolicLink()
                ? 'link'
                : a.isFile()
                  ? 'file'
                  : 'other',
            size: a.size,
            mtime: a.mtime * 1000,
          });
        }
      }
      entries.sort(
        (a, b) =>
          Number(b.type === 'directory') - Number(a.type === 'directory') ||
          a.name.localeCompare(b.name, 'zh-CN'),
      );
      return {
        path: actual,
        entries,
        files: entries.filter((e) => e.type !== 'directory').length,
        directories: entries.filter((e) => e.type === 'directory').length,
      };
    } finally {
      if (handle && channel)
        try {
          await this.handleCall(channel, 'close', handle);
        } catch {}
      this.listing = false;
    }
  }
  async calculateSize(parent: unknown, name: unknown) {
    this.check();
    if (this.calculating) throw fail('正在计算文件夹大小，请稍候', 409);
    this.calculating = true;
    const deadline = Date.now() + (this.scanTimeoutMs ?? 30000),
      limit = this.maxScanEntries ?? 10000;
    let count = 0,
      bytes = 0,
      files = 0,
      directories = 0;
    try {
      const target = this.target(parent, name),
        s = await this.channel();
      const rpc = <M extends keyof SftpOperations>(
        method: M,
        ...args: SftpOperations[M]['args']
      ) => {
        this.check();
        if (s !== this.sftp) throw fail('文件服务已重置，请重试', 409);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw fail('计算超过时间上限，请选择更小的文件夹');
        return this.perform(s, method, args, Math.min(remaining, this.timeoutMs));
      };
      const root = await rpc('lstat', target);
      if (!root.isDirectory() || root.isSymbolicLink()) throw fail('仅支持计算文件夹大小');
      const stack = [{ path: target, depth: 0 }];
      while (stack.length) {
        const item = stack.pop()!;
        if (item.depth > 64) throw fail('文件夹层级超过上限');
        const current = await rpc('lstat', item.path);
        if (!current.isDirectory() || current.isSymbolicLink()) continue;
        let handle: Buffer | null | undefined;
        try {
          handle = await rpc('opendir', item.path);
          while (true) {
            const batch = await rpc('readdir', handle);
            if (batch === false) break;
            for (const entry of batch) {
              if (['.', '..'].includes(entry.filename)) continue;
              if (++count > limit) throw fail('文件夹条目超过计算上限，请选择更小的文件夹');
              const a = entry.attrs;
              if (a.isSymbolicLink()) continue;
              if (a.isDirectory()) {
                directories++;
                stack.push({
                  path: path.posix.join(item.path, entry.filename),
                  depth: item.depth + 1,
                });
              } else if (a.isFile()) {
                if (
                  !Number.isSafeInteger(a.size) ||
                  a.size < 0 ||
                  !Number.isSafeInteger(bytes + a.size)
                )
                  throw fail('文件大小超出精确计算范围');
                bytes += a.size;
                files++;
              }
            }
          }
        } finally {
          if (handle && s === this.sftp) {
            if (Date.now() >= deadline) this.reset();
            else
              try {
                await rpc('close', handle);
              } catch {
                this.reset();
              }
          }
        }
      }
      return { bytes, files, directories };
    } finally {
      this.calculating = false;
    }
  }

  async write<T>(fn: () => Promise<T>) {
    this.check();
    if (this.writing) throw fail('已有文件操作正在进行', 409);
    this.writing = true;
    try {
      return await fn();
    } finally {
      this.writing = false;
    }
  }
  async mkdir(parent: unknown, name: unknown) {
    return this.write(async () => {
      const p = this.target(parent, name);
      if (await this.exists(p)) throw fail('同名文件或文件夹已存在', 409);
      await this.call('mkdir', p, { mode: 0o755 });
    });
  }
  async permissionInfo(parent: unknown, name: unknown) {
    const a = await this.call('lstat', this.target(parent, name));
    if (a.isSymbolicLink()) throw fail('暂不修改符号链接的权限');
    if (!a.isDirectory() && !a.isFile()) throw fail('仅支持普通文件和目录的权限');
    return {
      mode: a.mode & 0o7777,
      uid: a.uid,
      gid: a.gid,
      type: a.isDirectory() ? 'directory' : 'file',
    };
  }
  async chmod(parent: unknown, name: unknown, mode: unknown) {
    if (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 0 || mode > 0o7777)
      throw fail('权限值无效');
    return this.write(async () => {
      await this.permissionInfo(parent, name);
      await runArchive(this, {
        action: 'chmod',
        path: validPath(parent),
        name: validateName(name),
        mode,
      });
    });
  }
  async archive(
    action: unknown,
    parent: unknown,
    name: unknown,
    outputName: unknown,
    format: unknown,
  ) {
    if (action !== 'compress' && action !== 'extract') throw fail('压缩操作无效');
    const archivePath = validPath(parent),
      archiveName = validateName(name),
      archiveOutput = validateName(outputName);
    if (action === 'compress' && format !== 'zip' && format !== 'tar.gz')
      throw fail('压缩格式无效');
    return this.write(() =>
      runArchive(this, {
        action,
        path: archivePath,
        name: archiveName,
        outputName: archiveOutput,
        format: typeof format === 'string' ? format : undefined,
      }),
    );
  }
  async rename(parent: unknown, name: unknown, newName: unknown) {
    return this.write(async () => {
      const from = this.target(parent, name),
        to = this.target(parent, newName);
      if (from === to) return;
      if (await this.exists(to)) throw fail('同名文件或文件夹已存在', 409);
      const work = () => this.call('rename', from, to);
      if (this.audit)
        await this.audit.service.run(
          this.audit.owner,
          'ssh.rename',
          `${String(name)} → ${String(newName)}`,
          work,
        );
      else await work();
    });
  }
  async remove(parent: unknown, name: unknown) {
    return this.write(async () => {
      const p = this.target(parent, name),
        a = await this.call('lstat', p);
      try {
        const work = () => this.call(a.isDirectory() ? 'rmdir' : 'unlink', p);
        if (this.audit)
          await this.audit.service.run(this.audit.owner, 'ssh.delete', String(name), work);
        else await work();
      } catch (e) {
        if (a.isDirectory()) throw fail('无法删除该目录；请确认目录为空且具有权限');
        throw e;
      }
    });
  }
  track<T extends Readable | Writable>(stream: T): T {
    this.streams.add(stream);
    stream.once('close', () => this.streams.delete(stream));
    return stream;
  }
  async download(p: unknown) {
    this.check();
    if (this.readers >= 2) throw fail('最多同时下载两个文件', 409);
    this.readers++;
    try {
      const downloadPath = validPath(p);
      const attrs = await this.call('stat', downloadPath);
      if (!attrs.isFile()) throw fail('仅支持下载普通文件');
      const s = await this.channel(),
        handle = await this.handleCall(s, 'open', downloadPath, 'r');
      let offset = 0,
        pending = false,
        timer: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => stream.destroy(fail('下载长时间无进展，已取消')), this.idleMs);
      };
      const stream = this.track(
        new Readable({
          read: () => {
            if (pending) return;
            pending = true;
            const buffer = Buffer.alloc(64 * 1024);
            Promise.resolve()
              .then(() => this.handleCall(s, 'read', handle, buffer, 0, buffer.length, offset))
              .then(
                (bytes) => {
                  pending = false;
                  if (stream.destroyed) return;
                  touch();
                  if (bytes > 0) {
                    offset += bytes;
                    stream.push(buffer.subarray(0, bytes));
                  } else stream.push(null);
                },
                (e: unknown) => stream.destroy(e instanceof Error ? e : Error('文件传输失败')),
              );
          },
          destroy: (err, callback) => {
            clearTimeout(timer);
            Promise.resolve()
              .then(() => this.handleCall(s, 'close', handle))
              .then(
                () => callback(err),
                (e: unknown) => callback(err || (e instanceof Error ? e : Error('文件关闭失败'))),
              );
          },
        }),
      );
      stream.once('close', () => {
        this.readers--;
        clearTimeout(timer);
      });
      touch();
      return { name: path.posix.basename(downloadPath), size: attrs.size, stream };
    } catch (e) {
      this.readers--;
      throw e;
    }
  }
  async upload(
    parent: unknown,
    name: unknown,
    readable: Readable,
    {
      size,
      signal,
      onProgress,
    }: { size?: number; signal?: AbortSignal; onProgress?: (bytes: number) => void } = {},
  ) {
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD)
      throw fail('单个文件不能超过 256 MiB');
    return this.write(async () => {
      const target = this.target(parent, name);
      if (await this.exists(target)) throw fail('同名文件已存在，请修改上传名称', 409);
      const temp = path.posix.join(
          validPath(parent),
          '.toolbox-upload-' + randomBytes(16).toString('hex'),
        ),
        s = await this.channel();
      const controller = new AbortController(),
        abort = () => controller.abort();
      let handle: Buffer | null | undefined,
        attempted = false,
        total = 0,
        timer: ReturnType<typeof setTimeout> | undefined;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(abort, this.idleMs);
      };
      try {
        if (controller.signal.aborted) throw Object.assign(Error(), { name: 'AbortError' });
        attempted = true;
        handle = await this.handleCall(s, 'open', temp, 'wx', { mode: 0o600 });
        touch();
        let offset = 0;
        const sink = this.track(
          new Writable({
            write: (chunk: Buffer, encoding, callback) => {
              const position = offset;
              offset += chunk.length;
              Promise.resolve()
                .then(() => this.handleCall(s, 'write', handle!, chunk, 0, chunk.length, position))
                .then(() => {
                  if (!controller.signal.aborted) touch();
                  callback();
                }, callback);
            },
          }),
        );
        const counter = new Transform({
          transform(chunk: Buffer, encoding, cb) {
            total += chunk.length;
            if (total > size) return cb(fail('上传内容超过声明大小'));
            touch();
            onProgress?.(total);
            cb(null, chunk);
          },
        });
        await pipeline(readable, counter, sink, { signal: controller.signal });
        if (total !== size) throw fail('上传内容不完整');
        await this.handleCall(s, 'close', handle);
        handle = null;
        this.check();
        if (controller.signal.aborted) throw Object.assign(Error(), { name: 'AbortError' });
        if (await this.exists(target)) throw fail('同名文件已存在，请修改上传名称', 409);
        if (controller.signal.aborted) throw Object.assign(Error(), { name: 'AbortError' });
        await this.call('rename', temp, target);
      } catch (e) {
        if (handle)
          try {
            await this.handleCall(s, 'close', handle);
          } catch {}
        let cleanupFailed = false;
        if (attempted)
          try {
            if (await this.exists(temp)) await this.call('unlink', temp);
          } catch {
            cleanupFailed = true;
          }
        throw fail(
          (e instanceof Error && e.name === 'AbortError'
            ? '上传已取消或长时间无进展'
            : errorInfo(e).status
              ? errorInfo(e).message
              : '上传失败，请重试') + (cleanupFailed ? '；临时文件清理失败：' + temp : ''),
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    });
  }
}
