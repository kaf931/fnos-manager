import { OperationService } from '../../operations/service.js';
import { DatabaseService } from '../../persistence/database.service.js';
import { LanDiscovery } from '../../wake-discovery.js';
import { Injectable } from '@nestjs/common';
import { requestOwner } from '../../terminal/transport.js';
import { WakeService as Devices } from '../../wol.js';
import { Resources } from '../common/resources.js';
import type { ApiRequest, AppOptions } from '../common/types.js';
import { TerminalService } from '../terminal/terminal.service.js';
@Injectable()
export class WakeService {
  readonly discovery = new LanDiscovery();
  onModuleDestroy() {
    this.discovery.close();
  }
  constructor(
    public readonly service: Devices,
    public readonly owner: (req: ApiRequest) => string,
  ) {}
  static async create(
    { dataDir, gateway }: AppOptions,
    terminal: TerminalService,
    resources: Resources,
    database: DatabaseService,
    operations: OperationService,
  ) {
    const service = resources.add(
        'wakeService',
        await new Devices({
          dataDir,
          database,
          operations,
          terminalStore: terminal.store,
        }).init(),
      ),
      owner = (req: ApiRequest) => requestOwner(req, gateway);
    return new WakeService(service, owner);
  }
}
