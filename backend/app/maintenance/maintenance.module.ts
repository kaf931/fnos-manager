import { TerminalModule } from '../terminal/terminal.module.js';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
@Module({
  imports: [StorageModule, TerminalModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
