import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../persistence/database.service.js';
import { AdbRepository } from '../../persistence/adb.repository.js';
import { AdbSessions } from '../../adb/service.js';
import { AdbTransport } from '../../adb/transport.js';
import { Resources } from '../common/resources.js';
import { APP_OPTIONS, type AppOptions, type ApiRequest } from '../common/types.js';
import { requestOrigin } from '../../terminal/transport.js';
import { fail } from '../../terminal/model.js';
@Injectable()
export class AdbService {
  readonly repository: AdbRepository;
  readonly sessions: AdbSessions;
  readonly transport: AdbTransport;
  constructor(
    @Inject(DatabaseService) db: DatabaseService,
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
    @Inject(Resources) resources: Resources,
  ) {
    this.repository = new AdbRepository(db);
    this.sessions = new AdbSessions(options.root, options.dataDir);
    this.transport = new AdbTransport(this.sessions, options.gateway, options.root);
    resources.add('adbService', this);
  }
  list(owner: string) {
    return this.repository.list(owner).map(({ ownerUid: _owner, ...row }) => row);
  }
  private editable(owner: string, id: string) {
    if (this.sessions.uses(owner, id)) throw fail('请先关闭使用此配置的连接标签', 409);
  }
  save(owner: string, input: unknown, id?: string) {
    if (id) this.editable(owner, id);
    return { id: this.repository.save(owner, input, id).id };
  }
  move(owner: string, id: string, folderId: string | null) {
    this.repository.move(owner, id, folderId);
    return { ok: true };
  }
  remove(owner: string, id: string) {
    this.editable(owner, id);
    this.repository.remove(owner, id);
  }
  create(req: ApiRequest, id: string) {
    return this.sessions.create(
      req.terminalOwner,
      this.repository.get(req.terminalOwner, id),
      requestOrigin(req, this.options.gateway),
    );
  }
  async close() {
    this.transport.close();
    await this.sessions.close();
  }
}
