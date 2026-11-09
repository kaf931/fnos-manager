import { AdbModule } from './adb/adb.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { RdpModule } from './rdp/rdp.module.js';
import { VncModule } from './vnc/vnc.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { BackupModule } from './backup/backup.module.js';
import { Controller, Get, Module, Redirect, type DynamicModule } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { Resources } from './common/resources.js';
import type { AppOptions } from './common/types.js';
import { IconsModule } from './icons/icons.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TerminalModule } from './terminal/terminal.module.js';
import { WakeModule } from './wake/wake.module.js';
@Controller()
class EntryController {
  @Get() @Redirect('/app/deskicons/', 302) index() {}
}
@Module({ controllers: [EntryController] })
export class AppModule {
  static register(options: AppOptions, resources: Resources): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CommonModule.register(options, resources),
        IconsModule,
        TerminalModule,
        VncModule,
        AdbModule,
        RdpModule,
        StorageModule,
        WakeModule,
        TasksModule,
        BackupModule,
        NotificationsModule,
        OperationsModule,
        MaintenanceModule,
      ],
    };
  }
}
