import { DatabaseService } from '../../persistence/database.service.js';
import { TextVersionService, type TextVersionScope } from '../../terminal/text-versions.js';
import { checkTextFileAccess } from '../../terminal/text-files.js';
import { OperationService } from '../../operations/service.js';
import type { CatalogCommandDto, ConnectionDto, SessionDto } from './dto.js';
import { CommandRepository } from '../../persistence/command.repository.js';
import { TransferService } from '../../terminal/transfers.js';
import { MAX_UPLOAD, validateName, validPath } from '../../terminal/files.js';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { fail } from '../../terminal/model.js';
import { TerminalStore } from '../../terminal/store.js';
import { requestOrigin, TerminalService as TransportService } from '../../terminal/transport.js';
import { WorkspaceStore } from '../../terminal/workspace-store.js';
import { Resources } from '../common/resources.js';
import type { ApiRequest, AppOptions } from '../common/types.js';
@Injectable()
export class TerminalService {
  constructor(
    public readonly store: TerminalStore,
    public readonly service: TransportService,
    public readonly workspace: WorkspaceStore,
    public readonly ensureIdle: (owner: string, id: string) => void,
    public readonly gateway: boolean,
    public readonly transfers: TransferService,
    public readonly files: (req: ApiRequest) => import('../../terminal/files.js').SessionFiles,
    private readonly commands: CommandRepository,
  ) {}
  versionScope(req: ApiRequest, remotePath: unknown): TextVersionScope {
    const session = this.service.connectedOwned(req.terminalOwner, req.params.id);
    if (!session.acceptedFingerprint) throw fail('会话主机身份不可用', 409);
    return {
      owner: req.terminalOwner,
      connectionId: session.connection.id,
      host: session.connection.host,
      port: session.connection.port,
      username: session.connection.username,
      fingerprint: session.acceptedFingerprint,
      path: validPath(remotePath),
    };
  }
  versions!: TextVersionService;
  async fileVersions(req: ApiRequest, action: 'list' | 'read' | 'delete') {
    const scope = this.versionScope(req, req.query.path);
    // Every history action requires present, readable regular remote file, including delete.
    await checkTextFileAccess(this.files(req), scope.path);
    this.service.connectedOwned(req.terminalOwner, req.params.id);
    if (action === 'list') return { items: this.versions.list(scope) };
    if (action === 'read') return this.versions.read(scope, req.params.versionId);
    this.versions.remove(scope, req.params.versionId);
  }
  commandCatalog(owner: string) {
    return this.commands.list(owner);
  }
  saveCatalogCommand(owner: string, input: CatalogCommandDto, id?: string) {
    return this.commands.save(owner, input, id);
  }
  removeCatalogCommand(owner: string, id: string) {
    this.commands.remove(owner, id);
  }
  async updateConnection(owner: string, id: string, input: ConnectionDto) {
    this.store.get(owner, id);
    this.ensureIdle(owner, id);
    return this.store.save(owner, input, id);
  }
  async removeConnection(owner: string, id: string) {
    this.store.get(owner, id);
    this.ensureIdle(owner, id);
    await this.store.remove(owner, id);
  }
  async createSession(req: ApiRequest, input: SessionDto) {
    const origin = requestOrigin(req, this.gateway);
    return this.store.transaction(() => {
      const connection = this.store.get(req.terminalOwner, input?.connectionId);
      return this.service.create(req.terminalOwner, connection, origin);
    });
  }
  beginTransfer(req: ApiRequest, direction: 'upload' | 'download', size = 0, cancel?: () => void) {
    const session = this.service.connectedOwned(req.terminalOwner, req.params.id);
    if (!Number.isSafeInteger(size) || size < 0 || (direction === 'upload' && size > MAX_UPLOAD))
      throw fail('文件大小无效');
    const target = validPath(req.query.path);
    const fullPath =
      direction === 'upload' ? path.posix.join(target, validateName(req.query.name)) : target;
    return this.transfers.begin(
      {
        clientId:
          typeof req.query.clientId === 'string' && /^[a-f0-9-]{36}$/.test(req.query.clientId)
            ? req.query.clientId
            : undefined,
        owner: req.terminalOwner,
        sessionId: req.params.id,
        connectionName: session.connection.name,
        direction,
        path: fullPath,
        size,
      },
      cancel,
    );
  }
  static async create(
    { dataDir, gateway }: AppOptions,
    resources: Resources,
    database: DatabaseService,
    operations: OperationService,
  ) {
    const store = await new TerminalStore(dataDir, database).init(),
      service = resources.add('terminalService', new TransportService({ store, gateway })),
      workspace = await new WorkspaceStore(dataDir, store, database).init();
    const ensureIdle = (owner: string, id: string) => {
      if (service.usesConnection(owner, id)) throw fail('请先断开使用此配置的会话', 409);
    };
    store.beforeConnectionChange = ensureIdle;
    const transfers = new TransferService();
    service.subscribeSessionRemoved((id) => transfers.clearSession(id));
    const versions = resources.add('textVersions', new TextVersionService(database));
    const files = (req: ApiRequest) => {
      const files = service.connectedOwned(req.terminalOwner, req.params.id).files();
      files.textVersions = {
        capture: (remotePath, bytes, encoding) =>
          versions.capture(
            (() => {
              const session = service.connectedOwned(req.terminalOwner, req.params.id);
              if (!session.acceptedFingerprint) throw fail('会话主机身份不可用', 409);
              return {
                owner: req.terminalOwner,
                connectionId: session.connection.id,
                host: session.connection.host,
                port: session.connection.port,
                username: session.connection.username,
                fingerprint: session.acceptedFingerprint,
                path: remotePath,
              };
            })(),
            bytes,
            encoding,
          ),
      };
      files.audit = { service: operations, owner: req.terminalOwner };
      return files;
    };
    const terminal = new TerminalService(
      store,
      service,
      workspace,
      ensureIdle,
      gateway,
      transfers,
      files,
      new CommandRepository(database),
    );
    terminal.versions = versions;
    return terminal;
  }
}
