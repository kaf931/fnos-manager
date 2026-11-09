import { DatabaseService } from '../../persistence/database.service.js';
import { Module } from '@nestjs/common';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions } from '../common/types.js';
import { WakeModule } from '../wake/wake.module.js';
import { WakeService } from '../wake/wake.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
@Module({
  imports: [WakeModule],
  controllers: [TasksController],
  providers: [
    {
      provide: TasksService,
      inject: [APP_OPTIONS, WakeService, Resources, DatabaseService],
      useFactory: async (
        options: AppOptions,
        wake: WakeService,
        resources: Resources,
        database: DatabaseService,
      ) => TasksService.create(options, wake, resources, database),
    },
  ],
  exports: [TasksService],
})
export class TasksModule {}
