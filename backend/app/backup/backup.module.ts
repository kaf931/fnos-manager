import { Module } from '@nestjs/common';
import { BackupService } from '../../backup/service.js';
import { DatabaseService } from '../../persistence/database.service.js';
import { APP_OPTIONS, type AppOptions } from '../common/types.js';
import { BackupController } from './backup.controller.js';
@Module({
  controllers: [BackupController],
  providers: [
    {
      provide: BackupService,
      inject: [DatabaseService, APP_OPTIONS],
      useFactory: (db: DatabaseService, options: AppOptions) =>
        new BackupService(db, options.version),
    },
  ],
})
export class BackupModule {}
