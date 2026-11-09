import { OperationService } from '../../operations/service.js';
import { DatabaseService } from '../../persistence/database.service.js';
import { AiSkillsController } from './ai-skills.controller.js';
import { AiApplicationService } from './ai.service.js';
import { AiController } from './ai.controller.js';
import { Module } from '@nestjs/common';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions } from '../common/types.js';
import { TerminalController } from './terminal.controller.js';
import { TerminalService } from './terminal.service.js';
@Module({
  imports: [],
  controllers: [TerminalController, AiController, AiSkillsController],
  providers: [
    {
      provide: AiApplicationService,
      inject: [TerminalService, Resources, DatabaseService, OperationService],
      useFactory: (
        terminal: TerminalService,
        resources: Resources,
        database: DatabaseService,
        operations: OperationService,
      ) => AiApplicationService.create(terminal, resources, database, operations),
    },
    {
      provide: TerminalService,
      inject: [APP_OPTIONS, Resources, DatabaseService, OperationService],
      useFactory: async (
        options: AppOptions,
        resources: Resources,
        database: DatabaseService,
        operations: OperationService,
      ) => TerminalService.create(options, resources, database, operations),
    },
  ],
  exports: [TerminalService, AiApplicationService],
})
export class TerminalModule {}
