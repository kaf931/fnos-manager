import { CONFIG_LIMITS } from '../domain/config-limits.js';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { HostKey, TerminalConnection } from '../domain/terminal.js';
import { inputRecord } from '../errors.js';
import { DatabaseService } from '../persistence/database.service.js';
import { TerminalRepository } from '../persistence/terminal.repository.js';
import { validateCredentials } from './credentials.js';
import { fail, validateConnection } from './model.js';
import type { WorkspaceStore } from './workspace-store.js';
export type PublicConnection = TerminalConnection & {
  folderId: string | null;
  hasCredentials: boolean;
};
export class TerminalStore {
  readonly dir: string;
  pending: Promise<unknown> = Promise.resolve();
  readonly repository: TerminalRepository;
  beforeConnectionChange?: (owner: string, id: string) => void;
  workspace?: WorkspaceStore;
  constructor(
    readonly dataDir: string,
    database?: DatabaseService,
  ) {
    this.repository = new TerminalRepository(database ?? new DatabaseService(dataDir));
    this.dir = path.join(dataDir, 'terminal');
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    return this;
  }
  public(c: TerminalConnection): PublicConnection {
    return {
      ...c,
      credentials: c.credentials ? structuredClone(c.credentials) : undefined,
      folderId: c.folderId ?? null,
      hasCredentials: !!c.credentials,
    };
  }
  list(owner: string): PublicConnection[] {
    return this.repository.list(owner).map((c) => this.public(c));
  }
  get(owner: string, id: string): PublicConnection {
    const connection = this.repository.find(owner, id);
    if (!connection) throw fail('连接不存在', 404);
    return this.public(connection);
  }
  getCredentials(
    owner: string,
    id: string,
    expected?: Pick<TerminalConnection, 'host' | 'port' | 'username'>,
  ) {
    const c = this.repository.find(owner, id);
    if (!c) throw fail('连接不存在', 404);
    if (expected && (['host', 'port', 'username'] as const).some((key) => c[key] !== expected[key]))
      throw fail('连接配置已变化，请重新连接');
    return c.credentials ? validateCredentials(c.authMethod, c.credentials) : null;
  }
  transaction<T>(work: () => T | Promise<T>): Promise<T> {
    const job = this.pending.then(work);
    this.pending = job.catch(() => {});
    return job;
  }
  get connections() {
    return this.repository.list();
  }
  save(owner: string, value: unknown, id?: string) {
    const input = inputRecord(value),
      valid = validateConnection(input);
    return this.transaction(() => {
      if (id) this.beforeConnectionChange?.(owner, id);
      const previous = id ? this.repository.find(owner, id) : undefined;
      if (id && !previous) throw fail('连接不存在', 404);
      if (!id && this.repository.list(owner).length >= CONFIG_LIMITS.connections)
        throw fail('最多保存 100 个连接');
      const folderValue = input.folderId === undefined ? previous?.folderId : input.folderId;
      const folderId = this.workspace
        ? this.workspace.validateFolder(owner, folderValue)
        : (folderValue ?? null);
      if (folderId !== null && typeof folderId !== 'string') throw fail('所属目录无效');
      const c: TerminalConnection = {
        ...(previous ?? {
          id: randomBytes(12).toString('hex'),
          ownerUid: owner,
          createdAt: new Date().toISOString(),
        }),
        ...valid,
        folderId,
        updatedAt: new Date().toISOString(),
      };
      const method = input.authMethod ?? previous?.authMethod;
      if (method !== undefined) {
        if (method !== 'password' && method !== 'privateKey') throw fail('请选择密码或私钥认证');
        c.authMethod = method;
        const credentials = input.credentials == null ? undefined : inputRecord(input.credentials),
          secret = method === 'password' ? credentials?.password : credentials?.privateKey;
        if (method === 'privateKey' && !secret && credentials?.passphrase)
          throw fail('修改私钥口令时，请重新填写私钥');
        if (secret !== undefined && typeof secret !== 'string') throw fail('认证信息格式不正确');
        if (secret) c.credentials = validateCredentials(method, credentials);
        else if (previous?.credentials && previous.authMethod === method) {
          if ((['host', 'port', 'username'] as const).some((key) => previous[key] !== c[key]))
            throw fail('修改主机或用户名时，请重新填写认证信息');
        } else throw fail(method === 'password' ? '请输入密码' : '请输入私钥');
      }
      this.repository.save(c);
      return this.public(c);
    });
  }
  move(owner: string, id: string, folderId: unknown) {
    return this.transaction(() => {
      const c = this.repository.find(owner, id);
      if (!c) throw fail('连接不存在', 404);
      if (folderId === undefined) throw fail('请选择目标目录');
      if (!this.workspace) throw fail('工作区尚未初始化', 503);
      c.folderId = this.workspace.validateFolder(owner, folderId);
      c.updatedAt = new Date().toISOString();
      this.repository.save(c);
      return this.public(c);
    });
  }
  remove(owner: string, id: string) {
    return this.transaction(() => {
      this.beforeConnectionChange?.(owner, id);
      if (!this.repository.find(owner, id)) throw fail('连接不存在', 404);
      this.repository.remove(owner, id);
    });
  }
  getHostKey(owner: string, host: string, port: number, algorithm: string) {
    return this.repository.hostKeys(owner, host, port).find((key) => key.algorithm === algorithm);
  }
  getHostKeys(owner: string, host: string, port: number) {
    return this.repository.hostKeys(owner, host, port);
  }
  trustHostKey(
    owner: string,
    key: Omit<HostKey, 'ownerUid' | 'fingerprint'> & { fingerprint?: string },
  ) {
    const fingerprint =
      key.fingerprint ??
      'SHA256:' +
        createHash('sha256')
          .update(Buffer.from(key.key, 'base64'))
          .digest('base64')
          .replace(/=+$/, '');
    return this.transaction(() => this.repository.trust({ ...key, ownerUid: owner, fingerprint }));
  }
}
