import { GuacdRuntime } from '../../rdp/runtime.js';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../persistence/database.service.js';
import { RdpRepository } from '../../persistence/rdp.repository.js';
import { RdpTransport } from '../../rdp/transport.js';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions, type ApiRequest } from '../common/types.js';
import { requestOrigin } from '../../terminal/transport.js';
import { fail } from '../../terminal/model.js';
@Injectable()
export class RdpService {
  private readonly runtime: GuacdRuntime;
  readonly repository: RdpRepository;
  readonly transport: RdpTransport;
  constructor(
    @Inject(DatabaseService) db: DatabaseService,
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
    @Inject(Resources) resources: Resources,
  ) {
    this.runtime = resources.add(
      'rdpRuntime',
      new GuacdRuntime(options.root, 14822, options.dataDir),
    );
    this.repository = new RdpRepository(db);
    this.transport = resources.add('rdpService', new RdpTransport(options.gateway));
  }
  private assertEditable(owner: string, id: string) {
    if (this.transport.uses(owner, id)) throw fail('请先关闭使用此配置的连接标签', 409);
  }
  list(owner: string) {
    return this.repository.list(owner).map(({ ownerUid: _owner, ...row }) => row);
  }
  save(owner: string, input: unknown, id?: string) {
    if (id) this.assertEditable(owner, id);
    return { id: this.repository.save(owner, input, id).id };
  }
  remove(owner: string, id: string) {
    this.assertEditable(owner, id);
    this.repository.remove(owner, id);
  }
  move(owner: string, id: string, folderId: string | null) {
    this.repository.move(owner, id, folderId);
    return { ok: true };
  }
  async create(req: ApiRequest, id: string, width = 1280, height = 720) {
    const connection = this.repository.get(req.terminalOwner, id);
    await this.runtime.ensure();
    return this.transport.create(
      req.terminalOwner,
      connection,
      requestOrigin(req, this.options.gateway),
      width,
      height,
    );
  }
  close(owner: string, id: string) {
    this.transport.closeOwned(owner, id);
  }
  logs(owner: string, id: string) {
    return { items: this.transport.logs.read(owner, id) };
  }
}
