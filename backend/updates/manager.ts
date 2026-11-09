import { publicUpdateText } from './routes.js';
import { cancelUpdate } from './cancel.js';
import type { UpdateDownloadRoute } from '../domain/updates.js';
import { UpdateCache } from './cache.js';
import { carryDownload } from './download.js';
import { access, cp, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ReleaseInfo } from './releases.js';
import { readJob, terminalPhase, writeJob, type UpdateJob, type UpdateSpec } from './job.js';
export class UpdateManager {
  private starting = false;
  private cleaning = false;
  private cancelling = false;
  get cache() {
    return new UpdateCache(this.folder);
  }
  async clearCache(ids?: string[]) {
    if (this.starting || this.cleaning || this.cancelling)
      throw new Error('更新任务正在准备，请稍后清理');
    this.cleaning = true;
    try {
      return await this.cache.clear(ids);
    } finally {
      this.cleaning = false;
    }
  }
  async cancel(id: string) {
    if (this.starting || this.cleaning || this.cancelling)
      throw new Error('更新任务正在处理，请稍后重试');
    this.cancelling = true;
    try {
      const job = await this.status();
      if (!job || job.id !== id) throw new Error('更新任务已变化，请重新检查');
      return await cancelUpdate(this.dataDir, path.join(this.folder, job.id));
    } finally {
      this.cancelling = false;
    }
  }
  constructor(
    private readonly root: string,
    private readonly dataDir: string,
    private readonly current: string,
    private readonly gateway: boolean,
  ) {}
  private get folder() {
    return path.join(this.dataDir, 'updates');
  }
  async supported(): Promise<boolean> {
    if (
      !this.gateway ||
      process.platform !== 'linux' ||
      !['arm64', 'x64'].includes(process.arch) ||
      !process.env.TRIM_APPDEST ||
      !process.env.TRIM_PKGVAR
    )
      return false;
    try {
      return (
        (await realpath(this.root)) === (await realpath('/var/apps/deskicons/target')) &&
        (await realpath(this.dataDir)) === (await realpath(process.env.TRIM_PKGVAR)) &&
        (await realpath(this.root)) === (await realpath(process.env.TRIM_APPDEST)) &&
        (await access('/var/apps/deskicons/cmd/main').then(() => true))
      );
    } catch {
      return false;
    }
  }
  async status(): Promise<UpdateJob | null> {
    let id: string;
    try {
      id = JSON.parse(await readFile(path.join(this.folder, 'current.json'), 'utf8')).id;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('更新任务记录无效');
    const file = path.join(this.folder, id, 'status.json');
    const state = await readJob(file);
    if (
      state &&
      !terminalPhase(state.phase) &&
      (state.pid > 1 || Date.now() - state.updatedAt > 15000)
    ) {
      let running = false;
      try {
        if (state.pid > 1) {
          process.kill(state.pid, 0);
          running = true;
        }
      } catch {
        /* worker exited */
      }
      if (!running) {
        state.phase = 'failed';
        state.message = '更新进程已结束，请检查更新日志后重试';
        await rm(path.join(this.folder, 'installing'), { force: true });
        await writeJob(file, state);
      }
    }
    if (state && terminalPhase(state.phase))
      await rm(path.join(this.folder, 'installing'), { force: true });
    return state ? { ...state, message: publicUpdateText(state.message) } : null;
  }
  async start(
    release: ReleaseInfo,
    expected: string,
    automatic = false,
    downloadRoute: UpdateDownloadRoute = 'direct',
  ): Promise<UpdateJob> {
    if (this.starting || this.cleaning || this.cancelling)
      throw new Error('更新任务正在创建或清理');
    this.starting = true;
    let created: string | undefined;
    let launched = false;
    try {
      if (!(await this.supported())) throw new Error('当前运行环境不支持应用内更新');
      const previous = await this.status();
      if (previous && !terminalPhase(previous.phase)) throw new Error('已有更新任务正在进行');
      if (!release.hasUpdate || !release.latest || release.latest !== expected)
        throw new Error('没有匹配的新版本，请重新检查更新');
      if (
        !release.asset?.sha256 ||
        !/^[a-f0-9]{64}$/.test(release.asset.sha256) ||
        release.asset.size <= 0 ||
        release.asset.size > 512 * 1024 * 1024
      )
        throw new Error('此发布缺少有效安装包或 SHA-256 校验，无法自动更新');
      await mkdir(this.folder, { recursive: true, mode: 0o700 });
      const id = randomUUID(),
        jobDir = path.join(this.folder, id);
      await mkdir(jobDir, { mode: 0o700 });
      created = jobDir;
      const runtime = path.join(jobDir, 'helper');
      await cp(fileURLToPath(new URL('.', import.meta.url)), runtime, { recursive: true });
      await writeFile(path.join(jobDir, 'package.json'), '{"type":"module"}', { mode: 0o600 });
      let received = 0;
      if (previous && previous.version === release.latest.replace(/^v/, ''))
        received = await carryDownload(
          path.join(this.folder, previous.id, 'update.fpk'),
          path.join(jobDir, 'update.fpk'),
          { url: release.asset.url, size: release.asset.size, sha256: release.asset.sha256 },
        );
      if (previous) await rm(path.join(this.folder, previous.id), { recursive: true, force: true });
      const state: UpdateJob = {
        id,
        version: release.latest.replace(/^v/, ''),
        phase: 'downloading',
        received,
        total: release.asset.size,
        message: '正在准备下载',
        pid: 0,
        updatedAt: Date.now(),
      };
      const spec: UpdateSpec = {
        jobDir,
        automatic,
        downloadRoute,
        root: this.root,
        dataDir: this.dataDir,
        serviceScript: '/var/apps/deskicons/cmd/main',
        version: state.version,
        architecture: process.arch,
        previousVersion: this.current,
        asset: { url: release.asset.url, size: release.asset.size, sha256: release.asset.sha256 },
      };
      await writeJob(path.join(jobDir, 'status.json'), state);
      await writeFile(path.join(jobDir, 'spec.json'), JSON.stringify(spec), { mode: 0o600 });
      await writeFile(path.join(this.folder, 'current.json'), JSON.stringify({ id }), {
        mode: 0o600,
      });
      const log = await open(path.join(jobDir, 'update.log'), 'a', 0o600);
      try {
        const child = spawn(
          process.execPath,
          [path.join(runtime, 'worker.js'), path.join(jobDir, 'spec.json')],
          { detached: true, stdio: ['ignore', log.fd, log.fd], cwd: jobDir },
        );
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
        child.unref();
        launched = true;
      } finally {
        await log.close();
      }
      return { ...state, message: publicUpdateText(state.message) };
    } catch (e) {
      if (created && !launched) {
        await rm(created, { recursive: true, force: true }).catch(() => {});
        try {
          const pointer = JSON.parse(
            await readFile(path.join(this.folder, 'current.json'), 'utf8'),
          );
          if (pointer.id === path.basename(created))
            await rm(path.join(this.folder, 'current.json'), { force: true });
        } catch {
          /* no current task was published */
        }
      }
      throw e;
    } finally {
      this.starting = false;
    }
  }
}
