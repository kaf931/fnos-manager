import path from 'node:path';
import {
  AiSkillAuthorizationRepository,
  type SkillAuthorization,
} from '../../../persistence/ai-skill-authorization.repository.js';
import type { SkillPackageService } from './service.js';
import type { SkillPackageRef } from '../../../domain/ai-skill-packages.js';
import { DomainError, inputRecord } from '../../../errors.js';
import { prepareSkillRuntime, skillRemoteHome, shellArg } from './runtime.js';
import { digest } from './archive.js';
import { executeAiCommand, type AiExecSession } from '../executor.js';
export class FnOsSkillAuth {
  readonly repository: AiSkillAuthorizationRepository;
  private busy = new Set<string>();
  private controllers = new Set<AbortController>();
  private closed = false;
  private drains = new Set<Promise<unknown>>();
  private owners = new Map<AbortController, string>();
  constructor(
    private packages: SkillPackageService,
    private session: (owner: string, id: string) => AiExecSession & { connection?: { id: string } },
  ) {
    this.repository = new AiSkillAuthorizationRepository(packages.database);
  }
  private owned(owner: string, sessionId: string, id: string) {
    const r = this.repository.get(owner, id);
    if (r.connectionId !== this.session(owner, sessionId).connection?.id)
      throw new DomainError('请连接原 SSH 资产', 409);
    const m = this.packages.manifest(owner, r.skillId);
    if (!m.official || m.ref.packageId !== r.packageId)
      throw new DomainError('官方技能包已变更', 409);
    this.packages.enabled(owner, m.ref);
    return r;
  }
  status(owner: string, sessionId: string, id: string) {
    const r = this.owned(owner, sessionId, id);
    return {
      id: r.id,
      origin: r.origin,
      status: r.status,
      pendingAt: r.pendingAt,
      authorizationUrl:
        r.pendingAt && Date.now() - r.pendingAt < 300000 ? r.authorizationUrl : null,
    };
  }
  private async lock<T>(key: string, fn: (signal: AbortSignal) => Promise<T>) {
    if (this.closed || this.busy.has(key))
      throw new DomainError('授权请求处理中或服务正在关闭', 409);
    this.busy.add(key);
    const c = new AbortController();
    this.controllers.add(c);
    this.owners.set(c, key.split('\0')[0]!);
    const task = fn(AbortSignal.any([c.signal, AbortSignal.timeout(120000)]));
    this.drains.add(task);
    try {
      return await task;
    } finally {
      this.drains.delete(task);
      this.owners.delete(c);
      this.controllers.delete(c);
      this.busy.delete(key);
    }
  }
  private async call(
    r: SkillAuthorization,
    sessionId: string,
    args: string[],
    signal: AbortSignal,
  ) {
    const session = this.session(r.owner, sessionId),
      m = this.packages.manifest(r.owner, r.skillId),
      { home } = await skillRemoteHome(session, signal);
    const root = path.posix.join(
        home,
        '.local/share/nas-manager/skills',
        digest(Buffer.from(r.owner)),
        m.ref.skillId,
        m.ref.sha256,
      ),
      config = path.posix.join(
        home,
        '.local/share/nas-manager/authorizations',
        digest(Buffer.from(r.owner)),
        r.id,
      ),
      url = new URL(r.origin);
    // Creating private directories and invoking the fixed same-package launcher only; no user shell text.
    const command =
      'set -e; set +x; umask 077; mkdir -p -- ' +
      shellArg(config) +
      ' && chmod 700 -- ' +
      shellArg(config) +
      ' && unset FNOS_CLI_CONFIG_DIR FNOS_CLI_SESSION_STORAGE; ' +
      'FNOS_CLI_CONFIG_DIR=' +
      shellArg(config) +
      ' ' +
      (r.fileStorage ? 'FNOS_CLI_SESSION_STORAGE=file ' : '') +
      shellArg(root + '/scripts/fnos-cli') +
      ' ' +
      [
        '--host',
        url.hostname.replace(/^\[|\]$/g, ''),
        '--port',
        url.port || (url.protocol === 'https:' ? '443' : '80'),
        '--scheme',
        url.protocol.slice(0, -1),
        ...(url.protocol === 'http:' ? ['--allow-insecure-http'] : []),
        '--profile',
        r.profile,
        ...args,
      ]
        .map(shellArg)
        .join(' ');
    return executeAiCommand(session, command, { signal, timeoutMs: 120000 });
  }
  async begin(
    owner: string,
    sessionId: string,
    ref: SkillPackageRef,
    origin: string,
    fileStorage: boolean,
  ) {
    const m = this.packages.enabled(owner, ref);
    if (!m.official) throw new DomainError('仅支持已校验的官方飞牛包');
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    )
      throw new DomainError('请输入 NAS 根地址');
    const session = this.session(owner, sessionId),
      connection = session.connection?.id;
    if (!connection) throw new DomainError('SSH 资产不可用');
    return this.lock(owner + '\0' + connection + '\0' + url.origin, async (signal) => {
      const r = this.repository.create(owner, connection, m.ref, url.origin, fileStorage);
      if (r.tokenSaved)
        return {
          authorizationId: r.id,
          url: null,
          tokenSaved: true,
          connected: r.status === 'connected',
        };
      if (r.status === 'pending' && r.pendingAt && Date.now() - r.pendingAt < 300000)
        return { authorizationId: r.id, url: r.authorizationUrl, expiresAt: r.pendingAt + 300000 };
      await prepareSkillRuntime(session, owner, m, this.packages.store, signal);
      r.fileStorage = fileStorage;
      r.tokenSaved = false;
      const out = await this.call(r, sessionId, ['login', '--authorize-only'], signal);
      if (out.status !== 'success')
        throw new DomainError('无法生成授权链接，请检查 CLI 网络和安全存储');
      const data = inputRecord(JSON.parse(out.stdout)),
        link = String(
          data.authorization_url ||
            (data.data ? inputRecord(data.data).authorization_url : '') ||
            '',
        );
      const target = new URL(link);
      if (target.origin !== url.origin || target.username || target.password)
        throw new DomainError('授权链接与 NAS 目标不一致');
      r.status = 'pending';
      r.pendingAt = Date.now();
      r.authorizationUrl = link;
      this.repository.update(r);
      return { authorizationId: r.id, url: link, expiresAt: r.pendingAt + 300000 };
    });
  }
  async exchange(owner: string, sessionId: string, id: string, code: string) {
    const first = this.owned(owner, sessionId, id);
    return this.lock(owner + '\0' + first.connectionId + '\0' + first.origin, async (signal) => {
      const r = this.owned(owner, sessionId, id);
      if (!r.tokenSaved) {
        if (
          !r.pendingAt ||
          Date.now() - r.pendingAt > 300000 ||
          !code ||
          code.length > 4096 ||
          /[\x00-\x20\x7f]/.test(code)
        )
          throw new DomainError('授权码无效或链接已过期');
        r.pendingAt = null;
        r.authorizationUrl = null;
        r.status = 'disconnected';
        this.repository.update(r);
        const out = await this.call(r, sessionId, ['login', '--code', code], signal);
        if (out.status !== 'success') throw new DomainError('授权兑换失败，请重新授权');
        const data = inputRecord(JSON.parse(out.stdout));
        if (data.token_persisted !== true || data.refresh_token_persisted !== true)
          throw new DomainError('官方授权未完整保存');
        r.tokenSaved = true;
        this.repository.update(r);
      }
      const check = await this.call(r, sessionId, ['system', 'info'], signal);
      if (check.status !== 'success')
        throw new DomainError('凭据已保存，连接验证失败；可重试验证，无需重复兑换');
      r.status = 'connected';
      this.repository.update(r);
      return { connected: true };
    });
  }
  async disconnect(owner: string, sessionId: string, id: string) {
    const r = this.owned(owner, sessionId, id);
    return this.lock(owner + '\0' + r.connectionId + '\0' + r.origin, async (signal) => {
      const out = await this.call(r, sessionId, ['logout'], signal);
      if (out.status !== 'success') throw new DomainError('退出授权失败');
      r.status = 'disconnected';
      r.tokenSaved = false;
      r.pendingAt = null;
      r.authorizationUrl = null;
      this.repository.update(r);
      return { connected: false };
    });
  }
  context(owner: string, connectionId: string) {
    return this.repository
      .list(owner, connectionId)
      .filter((r) => r.status === 'connected')
      .map((r) => ({
        origin: r.origin,
        profile: r.profile,
        configDirectory:
          '$HOME/.local/share/nas-manager/authorizations/' +
          digest(Buffer.from(owner)) +
          '/' +
          r.id,
        fileStorage: r.fileStorage,
        instruction:
          '调用同包 CLI 时使用此 FNOS_CLI_CONFIG_DIR、profile 与目标，不读取 session 文件。',
      }));
  }
  cancelOwner(owner: string) {
    for (const [c, value] of this.owners) if (value === owner) c.abort();
  }
  async close() {
    this.closed = true;
    for (const c of this.controllers) c.abort();
    await Promise.allSettled([...this.drains]);
  }
}
