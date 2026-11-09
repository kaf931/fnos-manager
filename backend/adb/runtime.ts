import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createServer, connect } from 'node:net';
import { fail } from '../terminal/model.js';
interface OwnerRuntime {
  port: number;
  home: string;
  child: ChildProcessWithoutNullStreams;
  children: Set<ChildProcessWithoutNullStreams>;
  lastUsed: number;
}
export function adbFailure(output: string) {
  if (/unauthorized|authentication/i.test(output))
    return fail('设备尚未授权，请解锁 Android 并允许 USB/无线调试', 409);
  if (/offline/i.test(output)) return fail('ADB 设备离线，请重新连接', 409);
  if (/pair|password|code/i.test(output))
    return fail('ADB 配对失败，请检查配对地址、端口及配对码', 400);
  if (/permission denied|not permitted/i.test(output))
    return fail('Android 拒绝访问，请检查设备权限', 403);
  if (/no such file|does not exist/i.test(output)) return fail('设备文件不存在', 404);
  return fail('ADB 操作失败，请检查设备连接及 Android 调试授权', 502);
}
export class AdbRuntime {
  private owners = new Map<string, Promise<OwnerRuntime>>();
  private stopped = false;
  constructor(
    readonly root: string,
    readonly dataDir: string,
  ) {}
  async binary() {
    const files = process.env.DESKICONS_ADB_PATH
      ? [process.env.DESKICONS_ADB_PATH]
      : [
          path.join(this.root, 'tools', 'adb', 'bin', 'adb'),
          path.join(this.root, 'tools', 'adb', process.arch, 'bin', 'adb'),
          path.join(this.root, 'native', 'adb', `linux-${process.arch}`, 'adb'),
        ];
    for (const file of files) {
      try {
        await access(file, constants.X_OK);
        return file;
      } catch {}
    }
    throw fail(`当前运行环境缺少可执行的 ADB 依赖（${process.platform}/${process.arch}）`, 503);
  }
  private environment(home: string) {
    const env = { ...process.env };
    for (const key of [
      'ADB_SERVER_SOCKET',
      'ANDROID_ADB_SERVER_PORT',
      'ADB_TRACE',
      'ANDROID_SERIAL',
    ])
      delete env[key];
    return {
      ...env,
      HOME: home,
      ANDROID_USER_HOME: home,
      ANDROID_SDK_HOME: home,
      ADB_VENDOR_KEYS: path.join(home, '.android', 'adbkey'),
      ADB_MDNS_AUTO_CONNECT: '0',
      ADB_MDNS_OPENSCREEN: '0',
    };
  }
  async owner(owner: string): Promise<OwnerRuntime> {
    if (this.stopped) throw fail('ADB 服务正在停止', 503);
    let pending = this.owners.get(owner);
    if (!pending) {
      if (this.owners.size >= 16) throw fail('ADB 用户运行时已满', 429);
      pending = this.start(owner);
      this.owners.set(owner, pending);
      void pending.catch(() => {
        if (this.owners.get(owner) === pending) this.owners.delete(owner);
      });
    }
    return pending;
  }
  private async start(owner: string) {
    const binary = await this.binary(),
      home = path.join(this.dataDir, 'adb', createHash('sha256').update(owner).digest('hex'));
    await mkdir(path.join(home, '.android'), { recursive: true, mode: 0o700 });
    await chmod(home, 0o700);
    await chmod(path.join(home, '.android'), 0o700);
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (!address || typeof address === 'string') throw fail('ADB 本地端口分配失败', 503);
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      listener.close((e) => (e ? reject(e) : resolve())),
    );
    const ownerPending = this.owners.get(owner);
    // Google ADB rejects a hostname in server listen specs. Without -a, tcp:PORT binds loopback.
    const child = spawn(binary, ['-L', `tcp:${port}`, 'nodaemon', 'server'], {
        env: this.environment(home),
        stdio: 'pipe',
      }),
      runtime: OwnerRuntime = { port, home, child, children: new Set(), lastUsed: Date.now() };
    let spawnError = false;
    child.once('error', () => {
      spawnError = true;
    });
    child.stdout.resume();
    child.stderr.resume();
    try {
      for (let n = 0; n < 100; n++) {
        if (this.stopped || spawnError || child.exitCode !== null)
          throw fail('应用专属 ADB server 启动失败', 503);
        const ready = await new Promise<boolean>((resolve) => {
          const s = connect(port, '127.0.0.1');
          s.once('connect', () => {
            s.destroy();
            resolve(true);
          });
          s.once('error', () => resolve(false));
        });
        if (ready) {
          child.once('exit', () => {
            if (this.owners.get(owner) === ownerPending) this.owners.delete(owner);
            for (const c of runtime.children) c.kill('SIGKILL');
          });
          return runtime;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw fail('应用专属 ADB server 启动超时', 503);
    } catch (e) {
      child.kill('SIGKILL');
      throw e;
    }
  }
  async spawn(owner: string, args: string[]) {
    const r = await this.owner(owner),
      binary = await this.binary();
    r.lastUsed = Date.now();
    if (r.children.size >= 8) throw fail('ADB 并发操作已满，请稍后重试', 429);
    if (this.stopped) throw fail('ADB 服务正在停止', 503);
    const child = spawn(binary, ['-H', '127.0.0.1', '-P', String(r.port), ...args], {
      env: this.environment(r.home),
      stdio: 'pipe',
    });
    r.children.add(child);
    child.once('close', () => r.children.delete(child));
    child.on('error', () => {});
    return child;
  }
  async run(
    owner: string,
    args: string[],
    options: { input?: string; timeout?: number; maxOutput?: number; signal?: AbortSignal } = {},
  ) {
    const child = await this.spawn(owner, args),
      max = options.maxOutput ?? 4 * 1024 * 1024;
    return new Promise<string>((resolve, reject) => {
      let bytes = 0,
        done = false;
      const chunks: Buffer[] = [];
      let failure: unknown;
      const abort = () => {
        failure = fail('ADB 操作已取消', 499);
        child.kill('SIGKILL');
      };
      const timer = setTimeout(() => {
        failure = fail('ADB 操作超时', 504);
        child.kill('SIGKILL');
      }, options.timeout ?? 20000);
      timer.unref();
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      const collect = (b: Buffer) => {
        bytes += b.length;
        if (bytes > max) {
          failure = fail('ADB 输出超过大小限制', 413);
          child.kill('SIGKILL');
        } else chunks.push(b);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', () => {
        failure = fail('ADB 进程启动失败', 503);
      });
      child.once('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        const output = Buffer.concat(chunks).toString('utf8');
        if (failure) reject(failure);
        else if (code !== 0) reject(adbFailure(output));
        else resolve(output);
      });
      child.stdin.end(options.input);
    });
  }
  async pruneIdle(activeOwners: Set<string>) {
    for (const [owner, pending] of this.owners) {
      if (activeOwners.has(owner)) continue;
      void pending
        .then((r) => {
          if (
            !r.children.size &&
            Date.now() - r.lastUsed > 300000 &&
            this.owners.get(owner) === pending
          ) {
            this.owners.delete(owner);
            r.child.kill('SIGKILL');
          }
        })
        .catch(() => {});
    }
  }
  async close() {
    this.stopped = true;
    const runtimes = await Promise.allSettled(this.owners.values());
    for (const result of runtimes) {
      if (result.status !== 'fulfilled') continue;
      const r = result.value;
      for (const c of r.children) c.kill('SIGKILL');
      r.child.kill('SIGKILL');
    }
    this.owners.clear();
  }
}
