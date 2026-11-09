import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { OfficialConnection } from '../domain/icons.js';
import { DomainError, inputRecord } from '../errors.js';
import { DatabaseService } from '../persistence/database.service.js';
import { OfficialRepository } from '../persistence/official.repository.js';
import type { ProcessOptions } from './runner.js';
import { executeProcess } from './runner.js';
export class OfficialClient {
  declare dataDir: string;
  declare dir: string;
  readonly repository: OfficialRepository;
  declare binary: string;
  declare config: OfficialConnection;
  declare busy: boolean;

  constructor(dir: string, binary: string, database?: DatabaseService) {
    this.dataDir = dir;
    this.dir = path.join(dir, 'official');
    this.repository = new OfficialRepository(database ?? new DatabaseService(dir));
    this.binary = binary;
    this.config = { connected: false };
    this.busy = false;
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.config = this.repository.get();
    return this;
  }
  async save() {
    this.repository.save(this.config);
  }
  async state() {
    let installed = true;
    try {
      await access(this.binary);
    } catch {
      installed = false;
    }
    return {
      installed,
      connected: !!this.config.connected,
      origin: this.config.origin || '',
      fileStorage: !!this.config.fileStorage,
      pending: !!this.config.pending,
      authorizationUrl:
        this.config.pending && Date.now() - this.config.pending < 300000
          ? this.config.authorizationUrl
          : undefined,
    };
  }
  args(args: string[]) {
    const url = new URL(this.config.origin ?? '');
    return [
      '--host',
      url.hostname,
      '--port',
      url.port || (url.protocol === 'https:' ? '443' : '80'),
      '--scheme',
      url.protocol.slice(0, -1),
      ...(url.protocol === 'http:' ? ['--allow-insecure-http'] : []),
      '--profile',
      'nas-toolbox',
      ...args,
    ];
  }
  environment() {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FNOS_CLI_CONFIG_DIR: path.join(this.dir, 'session'),
    };
    delete env.FNOS_CLI_SESSION_STORAGE;
    if (this.config.fileStorage) env.FNOS_CLI_SESSION_STORAGE = 'file';
    return env;
  }
  async call(args: string[], options: ProcessOptions = {}) {
    if (!this.config.origin) throw new DomainError('请先连接官方授权');
    return executeProcess(this.binary, this.args(args), {
      ...options,
      timeoutMs: options.timeoutMs || 25000,
      env: this.environment(),
    });
  }
  async authorize(origin: string, fileStorage: boolean = false) {
    if (this.busy) throw new DomainError('授权请求处理中');
    if (this.config.pending && Date.now() - this.config.pending < 300000)
      throw new DomainError('已有待完成授权，请使用当前授权链接或等待五分钟后重试');
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new DomainError('请输入 NAS 的 HTTP(S) 访问地址');
    this.busy = true;
    try {
      this.config = {
        origin: url.origin,
        fileStorage: fileStorage === true,
        connected: false,
      };
      await this.save();
      const result = await this.call(['login', '--authorize-only']);
      if (result.code !== 0)
        throw new DomainError('无法生成授权链接，请检查官方 CLI 和 NAS 访问地址');
      let data;
      try {
        data = inputRecord(JSON.parse(result.stdout));
      } catch {
        throw new DomainError('官方 CLI 授权响应格式无法识别');
      }
      const authorizationUrl =
        data.authorization_url ||
        (data.data ? inputRecord(data.data).authorization_url : undefined);
      if (typeof authorizationUrl !== 'string' || !authorizationUrl)
        throw new DomainError('官方 CLI 未返回授权链接');
      const link = new URL(authorizationUrl);
      if (link.host !== url.host || !['http:', 'https:'].includes(link.protocol))
        throw new DomainError('授权链接与 NAS 地址不一致');
      this.config.authorizationUrl = authorizationUrl;
      this.config.pending = Date.now();
      await this.save();
      return { authorizationUrl, pending: true };
    } finally {
      this.busy = false;
    }
  }
  async exchange(code: unknown) {
    if (this.busy) throw new DomainError('授权请求处理中');
    if (
      typeof code !== 'string' ||
      !code.trim() ||
      code.length > 4096 ||
      /[\x00-\x20\x7f]/.test(code)
    )
      throw new DomainError('请输入有效的一次性授权码');
    if (!this.config.pending || Date.now() - this.config.pending > 300000)
      throw new DomainError('授权链接已过期，请重新连接');
    this.busy = true;
    try {
      const result = await this.call(['login', '--code', code]);
      delete this.config.pending;
      delete this.config.authorizationUrl;
      await this.save();
      if (result.code !== 0)
        throw new DomainError(
          '授权兑换或安全存储失败。请重新授权；无安全存储的设备可显式选择受限本地文件存储。',
        );
      let data;
      try {
        data = inputRecord(JSON.parse(result.stdout));
      } catch {
        throw new DomainError('无法确认官方 CLI 的授权持久化结果');
      }
      if (data.token_persisted !== true || data.refresh_token_persisted !== true)
        throw new DomainError('官方授权未完整保存，请重新连接');
      const verify = await this.call(['system', 'info']);
      if (verify.code !== 0)
        throw new DomainError('凭据已保存，但只读连接验证失败；请检查设备权限');
      this.config.connected = true;
      await this.save();
      return { connected: true };
    } finally {
      this.busy = false;
    }
  }
  async execute(args: string[], options?: ProcessOptions) {
    if (!this.config.connected) throw new DomainError('此任务需要先完成官方 OAuth 授权');
    return this.call(args, options);
  }
  async disconnect() {
    if (this.config.origin) await this.call(['logout']).catch(() => {});
    this.config = { connected: false };
    await this.save();
  }
  async modules() {
    const result = await this.execute(['logger', 'modules', '--locale', 'zh-CN']);
    if (result.code !== 0) throw new DomainError('无法读取日志模块，请检查日志访问授权');
    try {
      const data: unknown = JSON.parse(result.stdout);
      return data;
    } catch {
      return { text: result.stdout };
    }
  }
}
