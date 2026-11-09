import type { VncSettings } from '../../domain/vnc.js';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../persistence/database.service.js';
import { VncRepository } from '../../persistence/vnc.repository.js';
import { VncTransport } from '../../vnc/transport.js';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions, type ApiRequest } from '../common/types.js';
import { requestOrigin } from '../../terminal/transport.js';
import { fail } from '../../terminal/model.js';
@Injectable()
export class VncService {
  readonly repository: VncRepository;
  readonly transport: VncTransport;
  constructor(
    @Inject(DatabaseService) db: DatabaseService,
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
    @Inject(Resources) resources: Resources,
  ) {
    this.repository = new VncRepository(db);
    this.transport = resources.add('vncService', new VncTransport(options.gateway));
  }
  getSettings(owner: string) {
    return this.repository.getSettings(owner);
  }
  saveSettings(owner: string, settings: VncSettings) {
    return this.repository.saveSettings(owner, settings);
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
  create(req: ApiRequest, id: string) {
    return this.transport.create(
      req.terminalOwner,
      this.repository.get(req.terminalOwner, id),
      requestOrigin(req, this.options.gateway),
    );
  }
  close(owner: string, id: string) {
    this.transport.closeOwned(owner, id);
  }
  logs(owner: string, id: string) {
    return { items: this.transport.logs.read(owner, id) };
  }
}
