import { DatabaseService } from '../../persistence/database.service.js';
import { OperationService } from '../../operations/service.js';
import { DomainError } from '../../errors.js';
import type { ScanPageQuery, ScanHistoryQuery } from '../../persistence/scan.repository.js';
import type { PageOptions } from '../../domain/tasks.js';
import { Injectable } from '@nestjs/common';
import { DuplicateService } from '../../storage/duplicates.js';
import { BatchRenameService } from '../../storage/rename.js';
import { StorageService as Scanner } from '../../storage/service.js';
import { Resources } from '../common/resources.js';
import type { AppOptions } from '../common/types.js';
@Injectable()
export class StorageService {
  constructor(
    public readonly service: Scanner,
    public readonly duplicates: DuplicateService,
    public readonly rename: BatchRenameService,
  ) {}
  private closing?: Promise<void>;
  close() {
    return (this.closing ??= this.closeWorkers());
  }
  private async closeWorkers() {
    const errors: unknown[] = [];
    for (const worker of [this.duplicates, this.rename, this.service]) {
      try {
        await worker.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, '存储后台服务关闭失败');
  }
  scanEntries(owner: string, id: string, query: ScanPageQuery) {
    const repository = this.service.repository;
    if (!repository) throw new DomainError('扫描数据库不可用', 503);
    return repository.entries(owner, id, query);
  }
  scanHistory(owner: string, query: ScanHistoryQuery) {
    const repository = this.service.repository;
    if (!repository) throw new DomainError('扫描数据库不可用', 503);
    const page = repository.historyPage(owner, query);
    return {
      ...page,
      items: page.items.map((item) => {
        const { owner, worker, result, ...summary } = item;
        return summary;
      }),
    };
  }
  compareScans(
    owner: string,
    before: string,
    after: string,
    query: { page: number; pageSize: number; kind?: string },
  ) {
    const repository = this.service.repository;
    if (!repository) throw new DomainError('扫描数据库不可用', 503);
    return repository.compare(owner, before, after, query);
  }
  renameHistory(owner: string, query: PageOptions) {
    const page = this.rename.repository.historyPage(owner, query);
    return { ...page, items: page.items.map((item) => this.rename.public(item, false)) };
  }
  static async create(
    { dataDir, storageRoots, storageLimits }: AppOptions,
    resources: Resources,
    database: DatabaseService,
    operations: OperationService,
  ) {
    const service = await new Scanner({
      dataDir,
      database: database,
      roots: storageRoots,
      limits: storageLimits,
    }).init();
    // Register the coordinator before rename initialization so bootstrap failures drain all workers.
    const duplicates = new DuplicateService(service, operations);
    const rename = new BatchRenameService({
      dataDir,
      database: database,
      storage: service,
      operations,
    });
    const provider = resources.add(
      'storageService',
      new StorageService(service, duplicates, rename),
    );
    await rename.init();
    service.renameService = rename;
    return provider;
  }
}
