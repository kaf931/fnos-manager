import { ReminderRepository } from '../../persistence/reminder.repository.js';
import { Module } from '@nestjs/common';
import { NotificationRepository } from '../../persistence/notification.repository.js';
import { NotificationService } from '../../notifications/service.js';
import { DatabaseService } from '../../persistence/database.service.js';
import { Resources } from '../common/resources.js';
import { NotificationsController } from './notifications.controller.js';
@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NotificationService,
      inject: [DatabaseService, Resources],
      useFactory: (db: DatabaseService, resources: Resources) => {
        const repository = new NotificationRepository(db);
        return resources.add(
          'notificationService',
          new NotificationService(repository, undefined, new ReminderRepository(db, repository)),
        );
      },
    },
  ],
})
export class NotificationsModule {}
