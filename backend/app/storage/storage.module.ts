import { OperationService } from '../../operations/service.js';
import { DatabaseService } from '../../persistence/database.service.js';
import { TerminalModule } from '../terminal/terminal.module.js';
import { Module } from '@nestjs/common';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions } from '../common/types.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';
@Module({
  imports: [TerminalModule],
  controllers: [StorageController],
  providers: [
    {
      provide: StorageService,
      inject: [APP_OPTIONS, Resources, DatabaseService, OperationService],
      useFactory: async (
        options: AppOptions,
        resources: Resources,
        database: DatabaseService,
        operations: OperationService,
      ) => StorageService.create(options, resources, database, operations),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
