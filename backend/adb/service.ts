import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform, type Readable, type Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { AdbRuntime, adbFailure } from './runtime.js';
import { quoteRemoteArg, remotePath, validateAdbConnection } from './model.js';
import type { AdbConnection } from '../domain/adb.js';
import { fail } from '../terminal/model.js';
import { VncLogStore } from '../vnc/logs.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
export interface AdbSession {
  id: string;
  ownerUid: string;
  connection: AdbConnection;
  serial: string;
  origin: string;
  children: Set<ChildProcessWithoutNullStreams>;
  abort: AbortController;
  disposers: Set<() => void>;
  touched: number;
}
const MAX_TRANSFER = 256 * 1024 * 1024;
export class AdbSessions {
  private readonly targets = new Map<string, Promise<unknown>>();
  private target<T>(owner: string, serial: string, work: () => Promise<T>): Promise<T> {
    const key = owner + '\0' + serial;
    const next = (this.targets.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.targets.set(key, next);
    const clean = () => {
      if (this.targets.get(key) === next) this.targets.delete(key);
    };
    void next.then(clean, clean);
    return next;
  }
  readonly sessions = new Map<string, AdbSession>();
  readonly logs = new VncLogStore();
  readonly runtime: AdbRuntime;
  private readonly timer: NodeJS.Timeout;
  private starting = 0;
  private pendingOwners = new Map<string, number>();
  private closed = false;
  private transfers = new Map<string, number>();
  constructor(
    root: string,
    readonly dataDir: string,
  ) {
    this.runtime = new AdbRuntime(root, dataDir);
    this.timer = setInterval(() => {
      for (const s of this.sessions.values())
        if (Date.now() - s.touched > 60 * 60 * 1000) this.remove(s.id);
      void this.runtime.pruneIdle(new Set([...this.sessions.values()].map((s) => s.ownerUid)));
    }, 60000);
    this.timer.unref();
  }
  get(owner: string, id: string) {
    const s = this.sessions.get(id);
    if (!s || s.ownerUid !== owner) throw fail('ADB 会话不存在', 404);
    s.touched = Date.now();
    return s;
  }
  uses(owner: string, id: string) {
    return [...this.sessions.values()].some((s) => s.ownerUid === owner && s.connection.id === id);
  }
  async create(owner: string, c: AdbConnection, origin: string) {
    if (
      this.closed ||
      this.sessions.size + this.starting >= 32 ||
      [...this.sessions.values()].filter((s) => s.ownerUid === owner).length +
        (this.pendingOwners.get(owner) ?? 0) >=
        8
    )
      throw fail('ADB 会话已满', 409);
    this.starting++;
    this.pendingOwners.set(owner, (this.pendingOwners.get(owner) ?? 0) + 1);
    const id = randomUUID();
    this.logs.create(id, owner);
    this.logs.append(id, 'session', 'info', '正在连接 ADB 设备');
    const serial =
      c.deviceType === 'usb'
        ? c.serial
        : c.host.includes(':')
          ? `[${c.host}]:${c.port}`
          : `${c.host}:${c.port}`;
    try {
      return await this.target(owner, serial, async () => {
        if (c.deviceType !== 'usb') {
          const output = await this.runtime.run(owner, ['connect', serial]);
          if (!/connected to|already connected/i.test(output)) throw adbFailure(output);
        }
        const state = await this.runtime.run(owner, ['-s', serial, 'get-state']);
        if (state.trim() !== 'device') throw adbFailure(state);
        if (this.closed) throw fail('ADB 服务正在停止', 503);
        const s: AdbSession = {
          id,
          ownerUid: owner,
          connection: c,
          serial,
          origin,
          children: new Set(),
          abort: new AbortController(),
          disposers: new Set(),
          touched: Date.now(),
        };
        this.sessions.set(id, s);
        this.logs.append(id, 'auth', 'success', 'ADB 设备已连接并授权');
        return { id, connectionId: c.id, status: 'connected', serial };
      });
    } catch (e) {
      this.logs.append(id, 'network', 'error', e instanceof Error ? e.message : 'ADB 连接失败');
      this.logs.close(id);
      throw e;
    } finally {
      this.starting--;
      this.pendingOwners.set(owner, Math.max(0, (this.pendingOwners.get(owner) ?? 1) - 1));
    }
  }
  async pair(owner: string, host: string, port: number, code: string) {
    validateAdbConnection({ protocol: 'adb', name: 'pair', host, port });
    if (!/^\d{6}$/.test(code)) throw fail('配对码需为六位数字');
    const endpoint = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
    const output = await this.runtime.run(owner, ['pair', endpoint], {
      input: code + '\n',
      timeout: 30000,
    });
    if (!/successfully paired/i.test(output))
      throw fail('ADB 配对失败，请检查配对地址、端口及配对码');
    return { ok: true };
  }
  async devices(owner: string) {
    const output = await this.runtime.run(owner, ['devices', '-l']);
    return {
      items: output
        .split(/\r?\n/)
        .slice(1)
        .filter((s) => s.trim())
        .map((line) => {
          const [serial, status, ...more] = line.trim().split(/\s+/);
          return {
            serial,
            status,
            transport:
              more.some((value) => value.startsWith('usb:')) || !serial.includes(':')
                ? 'usb'
                : 'tcp',
            name: more.find((s) => s.startsWith('model:'))?.slice(6) || serial,
          };
        }),
    };
  }
  async run(
    s: AdbSession,
    args: string[],
    options: { timeout?: number; maxOutput?: number; signal?: AbortSignal } = {},
  ) {
    this.get(s.ownerUid, s.id);
    return this.runtime.run(s.ownerUid, ['-s', s.serial, ...args], {
      ...options,
      signal: options.signal ? AbortSignal.any([s.abort.signal, options.signal]) : s.abort.signal,
    });
  }
  async info(owner: string, id: string) {
    const s = this.get(owner, id),
      text = await this.run(s, ['shell', 'getprop']);
    const properties: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const m = /^\[([^\]]+)\]: \[(.*)\]\r?$/.exec(line);
      if (m) properties[m[1]] = m[2];
    }
    return { properties };
  }
  async shell(owner: string, id: string, command: string) {
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 65536 ||
      command.includes('\0')
    )
      throw fail('终端命令无效');
    const s = this.get(owner, id);
    return { output: await this.run(s, ['shell', command], { timeout: 60000 }) };
  }
  async files(owner: string, id: string, input: unknown) {
    const s = this.get(owner, id),
      p = remotePath(input ?? '/sdcard');
    const cmd = `find -H ${quoteRemoteArg(p)} -mindepth 1 -maxdepth 1 -exec stat -c '%f\t%s\t%Y\t%n' '{}' ';'`;
    const output = await this.run(s, ['shell', cmd]);
    const items = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [mode, size, modified, ...parts] = line.split('\t'),
          file = parts.join('\t');
        if (!/^[a-f0-9]+$/i.test(mode) || !/^\d+$/.test(size) || !file.startsWith('/')) return null;
        const bits = parseInt(mode, 16) & 0xf000;
        return {
          name: path.posix.basename(file),
          path: file,
          type: bits === 0x4000 ? 'directory' : bits === 0xa000 ? 'link' : 'file',
          size: Number(size),
          mtime: Number(modified) * 1000,
        };
      })
      .filter(Boolean);
    return { path: p, items };
  }
  async deleteFile(owner: string, id: string, input: unknown) {
    const s = this.get(owner, id),
      p = remotePath(input);
    if (p === '/') throw fail('不能删除设备根目录');
    await this.run(s, ['shell', `rm -f -- ${quoteRemoteArg(p)}`]);
    return { ok: true };
  }
  async rename(owner: string, id: string, input: unknown, target: unknown) {
    const s = this.get(owner, id),
      p = remotePath(input),
      dest = remotePath(target);
    if (p === '/' || dest === '/') throw fail('不能移动设备根目录');
    const source = quoteRemoteArg(p),
      destination = quoteRemoteArg(dest);
    const result = await this.run(s, [
      'shell',
      `if [ -e ${destination} ] || [ -L ${destination} ]; then printf ADB_TARGET_EXISTS; else mv -n -- ${source} ${destination} && if [ -e ${source} ] || [ -L ${source} ]; then printf ADB_TARGET_EXISTS; else printf ADB_RENAMED; fi; fi`,
    ]);
    if (result.trim() === 'ADB_TARGET_EXISTS') throw fail('目标路径已存在，请使用其他名称', 409);
    if (result.trim() !== 'ADB_RENAMED') throw fail('设备未确认重命名完成', 502);
    return { ok: true };
  }
  private limit(onBytes?: (bytes: number) => void) {
    let bytes = 0;
    return new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_TRANSFER) callback(fail('单次传输不能超过 256 MiB', 413));
        else {
          onBytes?.(bytes);
          callback(null, chunk);
        }
      },
    });
  }
  async upload(
    owner: string,
    id: string,
    input: Readable,
    dest: unknown,
    install = false,
    operationSignal?: AbortSignal,
  ) {
    const s = this.get(owner, id),
      target = install ? '' : remotePath(dest);
    const signal = operationSignal
      ? AbortSignal.any([s.abort.signal, operationSignal])
      : s.abort.signal;
    if ((this.transfers.get(owner) ?? 0) >= 2) throw fail('同时最多传输两个文件', 429);
    this.transfers.set(owner, (this.transfers.get(owner) ?? 0) + 1);
    let temp = '';
    let remoteTemp = '';
    try {
      await mkdir(path.join(this.dataDir, 'adb-transfers'), { recursive: true, mode: 0o700 });
      temp = await mkdtemp(path.join(this.dataDir, 'adb-transfers', 'transfer-'));
      await chmod(temp, 0o700);
      const file = path.join(temp, install ? 'package.apk' : 'upload');
      await pipeline(input, this.limit(), createWriteStream(file, { mode: 0o600 }), {
        signal,
      });
      this.get(owner, id);
      if (install) {
        const out = await this.run(s, ['install', '-r', file], { timeout: 120000, signal });
        if (!/Success/.test(out)) throw fail('APK 安装失败，请检查 APK 与设备兼容性', 400);
      } else {
        const destination = quoteRemoteArg(target);
        const exists = await this.run(
          s,
          [
            'shell',
            `if [ -e ${destination} ] || [ -L ${destination} ]; then printf ADB_TARGET_EXISTS; else printf ADB_TARGET_ABSENT; fi`,
          ],
          { signal },
        );
        if (exists.trim() === 'ADB_TARGET_EXISTS')
          throw fail('目标路径已存在，上传不会覆盖现有文件', 409);
        if (exists.trim() !== 'ADB_TARGET_ABSENT') throw fail('无法确认上传目标状态', 502);
        remoteTemp = '/data/local/tmp/deskicons-upload-' + randomUUID();
        await this.run(s, ['shell', `mkdir -m 700 -- ${quoteRemoteArg(remoteTemp)}`], { signal });
        const staged = remoteTemp + '/upload';
        await this.run(s, ['push', file, staged], { timeout: 120000, signal });
        const committed = await this.run(
          s,
          [
            'shell',
            `if [ -e ${destination} ] || [ -L ${destination} ]; then printf ADB_TARGET_EXISTS; else (set -C; cat -- ${quoteRemoteArg(staged)} > ${destination}) && printf ADB_UPLOADED; fi`,
          ],
          { timeout: 120000, signal },
        );
        if (committed.trim() === 'ADB_TARGET_EXISTS')
          throw fail('目标路径已存在，上传不会覆盖现有文件', 409);
        if (committed.trim() !== 'ADB_UPLOADED') throw fail('设备未确认上传完成', 502);
      }
      this.logs.append(id, 'session', 'success', install ? 'APK 安装完成' : '文件上传完成');
      return { ok: true };
    } finally {
      if (remoteTemp)
        await this.runtime
          .run(owner, ['-s', s.serial, 'shell', `rm -rf -- ${quoteRemoteArg(remoteTemp)}`], {
            timeout: 5000,
          })
          .catch(() => {});
      if (temp) await rm(temp, { recursive: true, force: true });
      this.transfers.set(owner, Math.max(0, (this.transfers.get(owner) ?? 1) - 1));
    }
  }
  async download(owner: string, id: string, input: unknown, output: Writable) {
    const s = this.get(owner, id),
      p = remotePath(input);
    if ((this.transfers.get(owner) ?? 0) >= 2) throw fail('同时最多传输两个文件', 429);
    this.transfers.set(owner, (this.transfers.get(owner) ?? 0) + 1);
    const cancelled = new AbortController();
    const cancel = () => {
      if (!output.writableFinished) cancelled.abort();
    };
    const signal = AbortSignal.any([s.abort.signal, cancelled.signal]);
    output.once('close', cancel);
    output.once('error', cancel);
    let child: ChildProcessWithoutNullStreams | undefined;
    let releaseProcessWait = () => {};
    try {
      const stat = await this.run(
        s,
        ['shell', `test -f ${quoteRemoteArg(p)} && stat -c '%s' -- ${quoteRemoteArg(p)}`],
        { signal },
      );
      if (!/^\d+\s*$/.test(stat) || Number(stat) > MAX_TRANSFER)
        throw fail('下载大小超过 256 MiB 或不是普通文件', 413);
      signal.throwIfAborted();
      child = await this.runtime.spawn(owner, [
        '-s',
        s.serial,
        'exec-out',
        `cat -- ${quoteRemoteArg(p)}`,
      ]);
      s.children.add(child);
      child.stdin.end();
      child.stderr.resume();
      const process = child;
      const completion = new Promise<void>((resolve, reject) => {
        const settle = (error?: Error) => {
          releaseProcessWait();
          if (error) reject(error);
          else resolve();
        };
        const error = () => settle(fail('ADB 下载失败', 502));
        const close = (code: number | null) => (code === 0 ? settle() : error());
        const aborted = () => settle(fail('ADB 下载已取消', 499));
        releaseProcessWait = () => {
          process.off('error', error);
          process.off('close', close);
          signal.removeEventListener('abort', aborted);
        };
        process.once('error', error);
        process.once('close', close);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
      void completion.catch(() => {});
      const timer = setTimeout(() => child?.kill('SIGKILL'), 120000);
      timer.unref();
      let received = 0;
      try {
        await Promise.all([
          pipeline(
            child.stdout,
            this.limit((bytes) => {
              received = bytes;
            }),
            output,
            { signal, end: false },
          ),
          completion,
        ]);
        if (signal.aborted) throw fail('ADB 下载已取消', 499);
        if (received !== Number(stat))
          throw fail('设备文件在下载期间发生变化，文件不完整，请重试', 409);
        const delivered = finished(output, { readable: false, cleanup: true });
        output.end();
        await delivered;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      releaseProcessWait();
      output.off('close', cancel);
      output.off('error', cancel);
      if (child) {
        s.children.delete(child);
        child.kill('SIGKILL');
      }
      this.transfers.set(owner, Math.max(0, (this.transfers.get(owner) ?? 1) - 1));
    }
  }
  remove(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.abort.abort();
    for (const dispose of s.disposers) dispose();
    for (const c of s.children) c.kill('SIGKILL');
    this.logs.append(id, 'disconnect', 'info', 'ADB 会话已关闭');
    this.logs.close(id);
    if (
      !this.closed &&
      s.connection.deviceType !== 'usb' &&
      ![...this.sessions.values()].some((x) => x.ownerUid === s.ownerUid && x.serial === s.serial)
    )
      void this.target(s.ownerUid, s.serial, async () => {
        if (
          !this.closed &&
          ![...this.sessions.values()].some(
            (x) => x.ownerUid === s.ownerUid && x.serial === s.serial,
          )
        )
          await this.runtime.run(s.ownerUid, ['disconnect', s.serial]);
      }).catch(() => {});
  }
  closeOwned(owner: string, id: string) {
    this.get(owner, id);
    this.remove(id);
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const id of this.sessions.keys()) this.remove(id);
    await this.runtime.close();
    this.logs.clear();
  }
}
