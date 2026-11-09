import type { UpdateDownloadRoute } from '../../domain/updates.js';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Resources } from './resources.js';
import {
  UpdatePolicyRepository,
  type UpdateMode,
} from '../../persistence/update-policy.repository.js';
import { UpdateManager } from '../../updates/manager.js';
import { APP_OPTIONS, type AppOptions } from './types.js';
import { DomainError } from '../../errors.js';
import { parseRelease, type ReleaseInfo } from '../../updates/releases.js';
@Injectable()
export class UpdatesService implements OnApplicationBootstrap, OnModuleDestroy {
  get cache() {
    return this.manager.cache;
  }
  clearCache(ids?: string[]) {
    return this.manager.clearCache(ids);
  }
  private retry?: ReturnType<typeof setInterval>;
  private autoPending = false;
  private initial?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  onApplicationBootstrap() {
    if (!this.options.gateway || !this.options.startScheduler) return;
    void this.manager.status().catch(() => {});
    this.initial = setTimeout(
      () =>
        void this.check()
          .then(() => this.tryAutomatic())
          .catch(() => {}),
      4000,
    );
    this.interval = setInterval(() => void this.check().catch(() => {}), 6 * 60 * 60 * 1000);
    this.retry = setInterval(() => void this.tryAutomatic().catch(() => {}), 60000);
    this.retry.unref();
    this.initial.unref();
    this.interval.unref();
  }
  onModuleDestroy() {
    clearInterval(this.retry);
    clearTimeout(this.initial);
    clearInterval(this.interval);
  }
  private pending: Promise<ReleaseInfo> | null = null;
  private cached: { time: number; info: ReleaseInfo } | null = null;
  private readonly manager: UpdateManager;
  constructor(
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
    @Inject(UpdatePolicyRepository) private readonly policy: UpdatePolicyRepository,
    @Inject(Resources) private readonly resources: Resources,
  ) {
    this.manager = new UpdateManager(
      options.root,
      options.dataDir,
      options.version,
      options.gateway,
    );
  }
  async status() {
    return {
      supported: await this.manager.supported(),
      job: await this.manager.status(),
      mode: this.policy.get().mode,
      idle: !this.resources.updateBusy,
    };
  }
  settings() {
    return this.policy.get();
  }
  async saveSettings(mode?: UpdateMode, downloadRoute?: UpdateDownloadRoute) {
    if (mode === 'auto' && !(await this.manager.supported()))
      throw new DomainError('当前环境不支持自动更新');
    const value = this.policy.save(mode, downloadRoute);
    if (mode === 'auto')
      void this.check()
        .then(() => this.tryAutomatic())
        .catch(() => {});
    return value;
  }
  async tryAutomatic() {
    const release = this.cached?.info;
    if (
      this.autoPending ||
      this.policy.get().mode !== 'auto' ||
      !release?.hasUpdate ||
      !release.latest ||
      !release.asset?.sha256 ||
      this.resources.updateBusy ||
      !this.policy.canAttempt(release.latest)
    )
      return;
    this.autoPending = true;
    try {
      const status = await this.manager.status();
      if (status && !['completed', 'failed', 'rolled-back', 'cancelled'].includes(status.phase))
        return;
      await this.manager.start(release, release.latest, true, this.policy.get().downloadRoute);
      this.policy.attempted(release.latest);
    } finally {
      this.autoPending = false;
    }
  }
  async cancel(id: string) {
    try {
      return await this.manager.cancel(id);
    } catch (error) {
      throw new DomainError(error instanceof Error ? error.message : '无法停止更新', 409);
    }
  }
  async install(version: string) {
    try {
      return await this.manager.start(
        await this.check(),
        version,
        false,
        this.policy.get().downloadRoute,
      );
    } catch (e) {
      throw new DomainError(e instanceof Error ? e.message : '无法启动更新');
    }
  }
  check(force = false): Promise<ReleaseInfo> {
    if (!force && this.cached && Date.now() - this.cached.time < 60000)
      return Promise.resolve(this.cached.info);
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async load(): Promise<ReleaseInfo> {
    try {
      const response = await fetch(
        'https://api.github.com/repos/kaf931/fnos-manager/releases/latest',
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'fnos-manager-update-check',
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.status !== 404 && !response.ok) throw new Error('GitHub 请求失败');
      const info = parseRelease(
        response.status === 404 ? null : await response.json(),
        this.options.version,
        process.arch,
      );
      this.cached = { time: Date.now(), info };
      return info;
    } catch {
      if (this.cached)
        return {
          ...this.cached.info,
          warning: '暂时无法连接 GitHub，当前显示上次检查结果，请稍后重新检查。',
        };
      throw new DomainError('暂时无法检查更新，请稍后重试或访问 GitHub 发布页。');
    }
  }
}
