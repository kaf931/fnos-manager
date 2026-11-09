import { publicUpdateText } from '../../updates/routes.js';
import { UpdatesService } from '../common/updates.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AiApplicationService } from '../terminal/ai.service.js';
import { MaintenanceRecordRepository } from '../../persistence/maintenance-record.repository.js';
import type { MaintenanceDetailKind, MaintenanceRecordPage } from '../../domain/maintenance.js';
import { Inject, Injectable, type OnApplicationBootstrap, Logger } from '@nestjs/common';
import { DatabaseService } from '../../persistence/database.service.js';
import { RetentionRepository } from '../../persistence/retention.repository.js';
import { Resources } from '../common/resources.js';
import { ServiceLog } from '../../maintenance/service-log.js';
import {
  historyKinds,
  type CleanupKind,
  type BatchRecordKind,
  type CleanupSummary,
  type HistoryLimits,
} from '../../domain/maintenance.js';
import { DomainError } from '../../errors.js';
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  readonly repository: RetentionRepository;
  readonly log: ServiceLog;
  private timer?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private logger = new Logger(MaintenanceService.name);
  constructor(
    @Inject(DatabaseService) db: DatabaseService,
    @Inject(Resources) private resources: Resources,
    @Inject(AiApplicationService) private ai: AiApplicationService,
    @Inject(StorageService) private storage: StorageService,
    @Inject(UpdatesService) private updates: UpdatesService,
  ) {
    this.repository = new RetentionRepository(db);
    this.log = new ServiceLog(db.dataDir);
    resources.add('maintenanceService', this);
  }
  onApplicationBootstrap() {
    void this.sweep().catch(() => this.logger.error('历史记录自动清理失败'));
    this.timer = setInterval(() => {
      void this.sweep().catch(() => this.logger.error('历史记录自动清理失败'));
    }, 60000);
    this.timer.unref();
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed || this.resources.shuttingDown) throw new DomainError('应用正在停止', 503);
    const task = this.queue.then(work);
    this.queue = task.catch(() => {});
    return task;
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.queue;
  }
  limits() {
    return this.repository.limits();
  }
  private async drain() {
    const s = this.storage;
    if (s) await Promise.all([s.service.pending, s.rename.pending]);
  }
  sweep() {
    return this.serial(async () => {
      await this.drain();
      this.trim();
    });
  }
  private trim() {
    const limits = this.limits(),
      s = this.storage;
    s?.service.pruneHistory();
    s?.rename.pruneHistory();
    for (const kind of historyKinds)
      if (kind !== 'scans' && kind !== 'renames') this.repository.trim(kind, limits[kind]);
    this.log.enforce(limits.serviceLogMiB * 1024 * 1024);
  }
  save(limits: HistoryLimits) {
    return this.serial(async () => {
      await this.drain();
      this.repository.save(limits);
      this.trim();
      return this.limits();
    });
  }
  async records(
    kind: MaintenanceDetailKind,
    owner: string,
    page: number,
    pageSize: number,
  ): Promise<MaintenanceRecordPage> {
    if (kind === 'updateCache') {
      const items = await this.updates.cache.records();
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      };
    }
    if (kind === 'aiHistory') {
      const pageResult = new MaintenanceRecordRepository(this.repository.database).page(
        kind,
        owner,
        page,
        pageSize,
      );
      const protectedIds = new Set(this.ai.conversations.openChatIds(owner));
      return {
        ...pageResult,
        items: pageResult.items.map((item) => ({
          ...item,
          status: protectedIds.has(item.id) ? 'in-use' : item.status,
        })),
      };
    }
    if (kind !== 'serviceLog')
      return new MaintenanceRecordRepository(this.repository.database).page(
        kind,
        owner,
        page,
        pageSize,
      );
    const items = this.log.files();
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    };
  }
  recordDetail(kind: MaintenanceDetailKind, owner: string, id: string) {
    if (kind === 'updateCache') return this.updates.cache.detail(id);
    if (kind === 'serviceLog') {
      const detail = this.log.detail(id);
      return { ...detail, text: publicUpdateText(detail.text) };
    }
    return new MaintenanceRecordRepository(this.repository.database).detail(kind, owner, id);
  }
  private attachmentProtectedCount(owner: string) {
    return Number(
      this.repository.database.connection
        .prepare(
          'SELECT count(*) n FROM ai_chat_attachments WHERE owner_uid=? AND deleted_at IS NULL AND chat_id IN(SELECT value FROM json_each(?))',
        )
        .get(owner, JSON.stringify(this.ai.conversations.protectedAttachmentChats(owner)))?.n,
    );
  }
  async summary(owner: string): Promise<CleanupSummary> {
    const updateCache = await this.updates.cache.records();
    const s = this.storage;
    const chats = this.ai.history.list(owner),
      openChats = new Set(this.ai.conversations.openChatIds(owner)),
      attachments = this.ai.attachments.list(owner, { pageSize: 1 }).summary;
    return {
      limits: this.limits(),
      items: [
        ...historyKinds.map((kind) => ({
          kind,
          ...this.repository.count(
            kind,
            owner,
            kind === 'scans'
              ? s?.service.protectedHistoryIds()
              : kind === 'renames'
                ? s?.rename.protectedHistoryIds()
                : [],
          ),
          bytes: null,
        })),
        {
          kind: 'updateCache',
          count: updateCache.length,
          protected: updateCache.filter((row) => row.status === 'in-use').length,
          bytes: updateCache.reduce((n, row) => n + (row.bytes || 0), 0),
        },
        { kind: 'serviceLog', ...this.log.summary(), protected: 0 },
        {
          kind: 'aiHistory',
          count: chats.length,
          protected: chats.filter((chat) => openChats.has(chat.id)).length,
          bytes: null,
        },
        {
          kind: 'attachments',
          count: attachments.count,
          protected: this.attachmentProtectedCount(owner),
          bytes: attachments.bytes,
        },
      ],
    };
  }
  removeSelected(owner: string, kind: BatchRecordKind, ids: string[], confirmed: boolean) {
    return this.serial(async () => {
      if (!confirmed) throw new DomainError('请确认删除所选记录');
      if (kind === 'updateCache')
        return { deleted: await this.updates.clearCache(ids), cleanupPending: false };
      if (kind === 'aiHistory') {
        const result = this.ai.history.removeSelected(
          owner,
          ids,
          this.ai.conversations.openChatIds(owner),
        );
        return { deleted: result.count, cleanupPending: result.cleanupPending };
      }
      const deleted =
        kind === 'serviceLog'
          ? this.log.clearSelected(ids)
          : this.repository.removeSelected(kind, owner, ids);
      return { deleted, cleanupPending: false };
    });
  }
  clean(owner: string, kinds: CleanupKind[], confirmed: boolean) {
    return this.serial(async () => {
      if (!confirmed) throw new DomainError('请确认清理历史记录');
      await this.drain();
      const s = this.storage;
      const deleted: Partial<Record<CleanupKind, number>> = {};
      let cleanupPending = false;
      for (const kind of kinds) {
        if (kind === 'updateCache') {
          deleted[kind] = await this.updates.clearCache();
          continue;
        }
        if (kind === 'aiHistory' || kind === 'attachments') {
          const result =
            kind === 'aiHistory'
              ? this.ai.cleanAllHistory(owner)
              : this.ai.cleanAllAttachments(owner);
          deleted[kind] = result.count;
          cleanupPending ||= result.cleanupPending;
          continue;
        }
        deleted[kind] =
          kind === 'scans'
            ? (s?.service.pruneHistory(owner, true) ?? 0)
            : kind === 'renames'
              ? (s?.rename.pruneHistory(owner, true) ?? 0)
              : kind === 'serviceLog'
                ? this.log.clear()
                : this.repository.clear(kind, owner).length;
      }
      return { deleted, summary: await this.summary(owner), cleanupPending };
    });
  }
}
