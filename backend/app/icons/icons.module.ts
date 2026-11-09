import { DatabaseService } from '../../persistence/database.service.js';
import { Module } from '@nestjs/common';
import { APP_OPTIONS, type AppOptions } from '../common/types.js';
import { IconsController } from './icons.controller.js';
import { IconsService } from './icons.service.js';
@Module({
  imports: [],
  controllers: [IconsController],
  providers: [
    {
      provide: IconsService,
      inject: [APP_OPTIONS, DatabaseService],
      useFactory: async (options: AppOptions, database: DatabaseService) =>
        IconsService.create(options, database),
    },
  ],
  exports: [IconsService],
})
export class IconsModule {}
