import { OperationService } from '../../operations/service.js';
import { DatabaseService } from '../../persistence/database.service.js';
import { Module } from '@nestjs/common';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions } from '../common/types.js';
import { TerminalModule } from '../terminal/terminal.module.js';
import { TerminalService } from '../terminal/terminal.service.js';
import { WakeController } from './wake.controller.js';
import { WakeService } from './wake.service.js';
@Module({
  imports: [TerminalModule],
  controllers: [WakeController],
  providers: [
    {
      provide: WakeService,
      inject: [APP_OPTIONS, TerminalService, Resources, DatabaseService, OperationService],
      useFactory: async (
        options: AppOptions,
        terminal: TerminalService,
        resources: Resources,
        database: DatabaseService,
        operations: OperationService,
      ) => WakeService.create(options, terminal, resources, database, operations),
    },
  ],
  exports: [WakeService],
})
export class WakeModule {}
