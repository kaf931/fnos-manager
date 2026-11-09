import type { AdbService } from '../adb/adb.service.js';
import type { MaintenanceService } from '../maintenance/maintenance.service.js';
import type { GuacdRuntime } from '../../rdp/runtime.js';
import type { RdpTransport } from '../../rdp/transport.js';
import type { VncTransport } from '../../vnc/transport.js';
import type { NotificationService } from '../../notifications/service.js';
import type { SkillPackageService } from '../../terminal/ai/skill-packages/service.js';
import type { FnOsSkillAuth } from '../../terminal/ai/skill-packages/fnos-auth.js';
import type { AiConversationService } from '../../terminal/ai/conversation.js';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { DatabaseService } from '../../persistence/database.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { TaskEngine } from '../../tasks/engine.js';
import type { TerminalService } from '../../terminal/transport.js';
import type { WakeService } from '../../wol.js';
import type { TextVersionService } from '../../terminal/text-versions.js';
interface ManagedServices {
  adbService?: AdbService;
  maintenanceService?: MaintenanceService;
  vncService?: VncTransport;
  rdpService?: RdpTransport;
  rdpRuntime?: GuacdRuntime;
  textVersions?: TextVersionService;
  notificationService?: NotificationService;
  skillPackages?: SkillPackageService;
  skillAuth?: FnOsSkillAuth;
  aiService?: AiConversationService;
  taskEngine?: TaskEngine;
  wakeService?: WakeService;
  storageService?: StorageService;
  terminalService?: TerminalService;
  database?: DatabaseService;
}
export class Resources implements OnModuleDestroy, OnApplicationBootstrap {
  private readonly services: ManagedServices = {};
  shuttingDown = false;
  private closing?: Promise<void>;
  private startScheduler = false;
  add<K extends keyof ManagedServices>(
    name: K,
    service: NonNullable<ManagedServices[K]>,
  ): NonNullable<ManagedServices[K]> {
    this.services[name] = service;
    return service;
  }
  get updateBusy(): boolean {
    const s = this.services;
    return !!(
      s.terminalService?.sessions.size ||
      s.vncService?.sessions.size ||
      s.adbService?.sessions.sessions.size ||
      s.rdpService?.sessions.size ||
      s.taskEngine?.running.size ||
      s.aiService?.busy ||
      s.storageService?.duplicates.active.size ||
      s.storageService?.rename.active.size ||
      s.storageService?.service.starting.size ||
      [...(s.storageService?.service.jobs.values() || [])].some((job) => job.status === 'running')
    );
  }
  scheduler(enabled: boolean) {
    this.startScheduler = enabled;
  }
  onApplicationBootstrap() {
    this.services.notificationService?.start();
    if (this.startScheduler) this.services.taskEngine?.start();
  }
  onModuleDestroy() {
    return this.close();
  }
  close() {
    return (this.closing ??= this.dispose());
  }
  private async dispose() {
    this.shuttingDown = true;
    const errors: unknown[] = [];
    for (const name of [
      'maintenanceService',
      'taskEngine',
      'wakeService',
      'storageService',
      'aiService',
      'skillAuth',
      'skillPackages',
      'terminalService',
      'vncService',
      'adbService',
      'rdpService',
      'rdpRuntime',
      'textVersions',
      'notificationService',
      'database',
    ] as const)
      try {
        await this.services[name]?.close();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, '后台服务关闭失败');
  }
}
