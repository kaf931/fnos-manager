import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { connect } from 'node:net';
import { fail } from '../terminal/model.js';
/** One foreground, loopback-only engine owned by this application process. */
export class GuacdRuntime {
  private child?: ChildProcess;
  private pending?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly root: string,
    readonly port = 14822,
    private readonly dataDir?: string,
  ) {}
  ensure() {
    if (this.stopping) return Promise.reject(fail('应用正在关闭', 503));
    return (this.pending ??= this.start().catch((error) => {
      this.pending = undefined;
      throw error;
    }));
  }
  private async start() {
    const dir = path.join(this.root, 'tools/rdp'),
      executable = path.join(dir, 'bin/guacd');
    try {
      await access(executable);
    } catch {
      throw fail('RDP 引擎尚未安装，请更新完整安装包', 503);
    }
    // FreeRDP owns certificate storage. Keep its HOME outside replaceable runtime files.
    const home = this.dataDir ? path.join(this.dataDir, 'rdp') : undefined;
    if (home) {
      await mkdir(path.join(home, '.config'), { recursive: true, mode: 0o700 });
      await chmod(home, 0o700);
      await chmod(path.join(home, '.config'), 0o700);
    }
    const child = (this.child = spawn(
      executable,
      ['-f', '-b', '127.0.0.1', '-l', String(this.port), '-L', 'error'],
      {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: path.join(dir, 'lib'),
          ...(home ? { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } : {}),
        },
        stdio: 'ignore',
      },
    ));
    let exited = false;
    child.once('error', () => {
      exited = true;
    });
    child.once('exit', () => {
      exited = true;
      this.pending = undefined;
    });
    for (let n = 0; n < 50; n++) {
      await new Promise((r) => setTimeout(r, 100));
      if (exited || this.stopping) break;
      const ready = await new Promise<boolean>((resolve) => {
        const socket = connect(this.port, '127.0.0.1');
        socket.setTimeout(150);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });
      if (ready && !exited) return;
    }
    child.kill('SIGTERM');
    throw fail('RDP 引擎启动失败，请检查运行依赖与端口', 503);
  }
  async close() {
    this.stopping = true;
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
