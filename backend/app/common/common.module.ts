import { UpdatePolicyRepository } from '../../persistence/update-policy.repository.js';
import { UpdatesController } from './updates.controller.js';
import { UpdatesService } from './updates.service.js';
import { OperationRepository } from '../../persistence/operation.repository.js';
import { OperationService } from '../../operations/service.js';
import { PreferencesService } from './preferences.service.js';
import { PreferencesController } from './preferences.controller.js';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { DatabaseService } from '../../persistence/database.service.js';
import { Resources } from './resources.js';
import { GatewayAccess, GatewayGuard, StorageOwnerGuard, TerminalOwnerGuard } from './security.js';
import { APP_OPTIONS, type AppOptions } from './types.js';
@Global()
@Module({})
export class CommonModule {
  static register(options: AppOptions, resources: Resources): DynamicModule {
    return {
      module: CommonModule,
      controllers: [PreferencesController, UpdatesController],
      providers: [
        {
          provide: DatabaseService,
          inject: [APP_OPTIONS, Resources],
          useFactory: (options: AppOptions, resources: Resources) =>
            resources.add('database', new DatabaseService(options.dataDir)),
        },
        {
          provide: OperationService,
          inject: [DatabaseService],
          useFactory: (database: DatabaseService) => {
            const repository = new OperationRepository(database);
            repository.recover();
            return new OperationService(repository);
          },
        },
        { provide: APP_OPTIONS, useValue: options },
        { provide: Resources, useValue: resources },
        PreferencesService,
        UpdatesService,
        UpdatePolicyRepository,
        GatewayAccess,
        GatewayGuard,
        TerminalOwnerGuard,
        StorageOwnerGuard,
      ],
      exports: [
        UpdatesService,
        OperationService,
        DatabaseService,
        APP_OPTIONS,
        Resources,
        GatewayAccess,
        GatewayGuard,
        TerminalOwnerGuard,
        StorageOwnerGuard,
      ],
    };
  }
}
