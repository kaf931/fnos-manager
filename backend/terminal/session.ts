import { createHash } from 'node:crypto';
import type { AnyAuthMethod, ClientChannel, Client as SSHClient } from 'ssh2';
import ssh2 from 'ssh2';
import type {
  ConnectionStage,
  ConnectionDiagnostic,
  SessionState,
  TerminalEvent,
} from '../domain/terminal-files.js';
import type { HostKey, TerminalConnection } from '../domain/terminal.js';
import { inputRecord } from '../errors.js';
import { SessionFiles } from './files.js';
import { fail } from './model.js';
import { SessionMonitor } from './monitor.js';
import type { TerminalStore } from './store.js';
const { Client, utils } = ssh2;
const messages: Readonly<Record<string, string>> = {
  AUTH_FAILED: 'SSH 认证失败，请返回编辑连接检查账号和认证信息',
  SAVED_CREDENTIALS_UNAVAILABLE: '保存的认证信息不可用，请检查连接配置或恢复应用认证密钥备份',
  TIMEOUT: '连接等待超时，请重试',
  ENOTFOUND: '无法解析目标主机',
  ECONNREFUSED: '目标拒绝连接，请检查 SSH 端口',
  ECONNRESET: '连接已中断',
  INVALID_KEY: '私钥格式或口令不正确',
  CONNECT_FAILED: '无法建立 SSH 连接',
  OUTPUT_LIMIT: '终端输出过多，连接已关闭',
};
export class TerminalSession {
  private diagnosticStage: ConnectionStage | undefined;
  diagnostic(stage: ConnectionStage, status: ConnectionDiagnostic['status'], message: string) {
    if (this.closed) return;
    if (status === 'running' || status === 'waiting') this.diagnosticStage = stage;
    else if (this.diagnosticStage === stage) this.diagnosticStage = undefined;
    this.emit({ type: 'diagnostic', stage, status, message, at: Date.now() });
  }
  declare state: SessionState;
  declare closed: boolean;
  declare size: { cols: number; rows: number };
  declare emit: (event: TerminalEvent) => void;
  declare timer: NodeJS.Timeout | undefined;
  declare timers: { handshake: number; wait: number };
  declare client: SSHClient | null;
  declare clientFactory: () => SSHClient;
  declare stream: ClientChannel | null;
  declare connection: TerminalConnection;
  declare store: TerminalStore;
  declare ownerUid: string;
  declare hostCallback: ((accept: boolean) => void) | null;
  declare hostKey: Omit<HostKey, 'ownerUid'> | undefined;
  declare acceptedFingerprint: string | undefined;
  declare hostChanged: boolean;
  declare authAttempted: boolean;
  declare authCallback: ((auth: AnyAuthMethod | false) => void) | null;
  declare trusting: boolean;
  declare monitorService: SessionMonitor | undefined;
  declare fileService: SessionFiles | undefined;

  constructor({
    connection,
    ownerUid,
    store,
    emit,
    clientFactory = () => new Client(),
    timers = { handshake: 30000, wait: 60000 },
  }: {
    connection: TerminalConnection;
    ownerUid: string;
    store: TerminalStore;
    emit: (event: TerminalEvent) => void;
    clientFactory?: () => SSHClient;
    timers?: { handshake: number; wait: number };
  }) {
    Object.assign(this, {
      connection,
      ownerUid,
      store,
      emit,
      clientFactory,
      timers,
    });
    this.state = 'pending';
    this.closed = false;
    this.size = { cols: 80, rows: 24 };
  }
  setState(state: SessionState) {
    this.state = state;
    this.emit({ type: 'state', state });
  }
  timeout(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.error('TIMEOUT'), ms);
    this.timer.unref?.();
  }
  error(code: string) {
    if (this.closed) return;
    if (this.diagnosticStage)
      this.diagnostic(this.diagnosticStage, 'failed', messages[code] || messages.CONNECT_FAILED);
    this.emit({
      type: 'error',
      code,
      message: messages[code] || messages.CONNECT_FAILED,
    });
    this.close();
  }
  start() {
    if (this.state !== 'pending') throw fail('会话已经开始');
    this.setState('connecting');
    this.diagnostic('network', 'running', '正在解析主机并建立 TCP 连接');
    this.timeout(this.timers.handshake);
    const c = (this.client = this.clientFactory());
    c.on('connect', () => {
      if (this.closed) return;
      this.diagnostic('network', 'passed', 'TCP 连接已建立');
      this.diagnostic('handshake', 'running', '正在协商 SSH 协议与密钥');
    });
    c.on('error', (err: Error & { level?: string; code?: string }) =>
      this.error(
        err.level === 'client-authentication'
          ? 'AUTH_FAILED'
          : err.code === 'ETIMEDOUT'
            ? 'TIMEOUT'
            : messages[err.code ?? '']
              ? err.code!
              : 'CONNECT_FAILED',
      ),
    );
    c.on('close', () => this.close());
    c.on('ready', () => {
      if (this.closed) return;
      this.diagnostic('authentication', 'passed', 'SSH 认证通过');
      c.shell(
        { term: 'xterm-256color', cols: this.size.cols, rows: this.size.rows },
        (err, stream) => {
          if (err) return this.error('CONNECT_FAILED');
          if (this.closed) {
            stream.close();
            return;
          }
          clearTimeout(this.timer);
          this.stream = stream;
          this.setState('connected');
          // Probe only the SFTP subsystem; never run diagnostic shell commands.
          void this.files()
            .channel()
            .catch(() => {});
          stream.on('error', () => this.error('ECONNRESET'));
          stream.on('close', () => this.close());
          stream.on('data', (data: Buffer) => {
            if (data.length > 1024 * 1024) return this.error('OUTPUT_LIMIT');
            this.emit({ type: 'output', data: data.toString('base64') });
          });
          stream.stderr?.on('data', (data: Buffer) =>
            this.emit({ type: 'output', data: data.toString('base64') }),
          );
        },
      );
    });
    try {
      c.connect({
        host: this.connection.host,
        port: this.connection.port,
        username: this.connection.username,
        readyTimeout: 0,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, callback: (accept: boolean) => void) => {
          if (this.closed) return callback(false);
          this.diagnostic('handshake', 'passed', 'SSH 密钥协商已到达主机身份验证');
          this.diagnostic('fingerprint', 'running', '正在核对 SSH 主机指纹');
          const parsed = utils.parseKey(key);
          if (parsed instanceof Error || Array.isArray(parsed)) {
            this.diagnostic('fingerprint', 'failed', '目标主机密钥无法识别');
            return callback(false);
          }
          const fingerprint =
            'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
          const publicKey = key.toString('base64'),
            algorithm = parsed.type;
          const saved = this.store.getHostKey(
            this.ownerUid,
            this.connection.host,
            this.connection.port,
            algorithm,
          );
          this.acceptedFingerprint = fingerprint;
          if (saved?.key === publicKey) {
            this.diagnostic('fingerprint', 'passed', '主机指纹与已保存的信任一致');
            callback(true);
            return;
          }
          this.hostCallback = callback;
          this.hostKey = {
            host: this.connection.host,
            port: this.connection.port,
            algorithm,
            key: publicKey,
            fingerprint,
          };
          const previous = this.store.getHostKeys(
            this.ownerUid,
            this.connection.host,
            this.connection.port,
          );
          this.hostChanged = previous.length > 0;
          this.diagnostic(
            'fingerprint',
            'waiting',
            this.hostChanged
              ? '主机指纹已变化，等待明确替换信任'
              : '首次连接，等待用户核对并确认指纹',
          );
          this.setState('host-key');
          this.timeout(this.timers.wait);
          this.emit({
            type: 'host-key',
            host: this.connection.host,
            port: this.connection.port,
            algorithm,
            fingerprint,
            changed: this.hostChanged,
            previousFingerprints: previous.map((k) => k.fingerprint),
          });
        },
        authHandler: (_methods, _partial, callback) => {
          // ssh2 accepts false to stop authentication; its declaration omits this sentinel.
          const next = callback as (auth: AnyAuthMethod | false) => void;
          if (this.closed) return next(false);
          if (this.authAttempted) {
            next(false);
            return;
          }
          this.diagnostic('authentication', 'waiting', '等待提交 SSH 认证信息');
          this.authCallback = next;
          this.setState('credentials');
          this.timeout(this.timers.wait);
          try {
            const saved = this.connection.id
              ? this.store.getCredentials(this.ownerUid, this.connection.id, this.connection)
              : null;
            if (saved) {
              this.authenticate(saved);
              return;
            }
            this.emit({ type: 'credentials-required' });
          } catch {
            this.error('SAVED_CREDENTIALS_UNAVAILABLE');
          }
        },
      });
    } catch {
      this.error('CONNECT_FAILED');
    }
  }
  async acceptHost(value: unknown) {
    const { fingerprint, replace } = inputRecord(value);
    if (this.state !== 'host-key' || !this.hostKey || fingerprint !== this.hostKey.fingerprint)
      throw fail('主机确认已失效');
    if (this.hostChanged && replace !== true) throw fail('主机密钥已变化，需要明确替换信任');
    if (this.trusting) throw fail('正在保存主机信任');
    this.trusting = true;
    try {
      await this.store.trustHostKey(this.ownerUid, this.hostKey);
      if (this.closed) return;
      const cb = this.hostCallback;
      this.hostCallback = null;
      this.setState('connecting');
      this.timeout(this.timers.handshake);
      this.diagnostic('fingerprint', 'passed', '用户已确认并保存主机信任');
      cb?.(true);
    } finally {
      this.trusting = false;
    }
  }
  authenticate(value: unknown) {
    const credentials = inputRecord(value);
    if (this.state !== 'credentials' || !this.authCallback) throw fail('当前不能提交认证');
    const { method } = credentials;
    let auth: AnyAuthMethod;
    if (method === 'password') {
      if (
        typeof credentials.password !== 'string' ||
        !credentials.password ||
        credentials.password.length > 4096
      )
        throw fail('请输入密码');
      auth = {
        type: 'password',
        username: this.connection.username,
        password: credentials.password,
      };
    } else if (method === 'privateKey') {
      if (
        typeof credentials.privateKey !== 'string' ||
        credentials.privateKey.length > 65536 ||
        (typeof credentials.passphrase !== 'undefined' &&
          typeof credentials.passphrase !== 'string') ||
        (typeof credentials.passphrase === 'string' && credentials.passphrase.length > 4096)
      )
        throw fail('私钥内容过大或格式不正确');
      const key = utils.parseKey(credentials.privateKey, credentials.passphrase || undefined);
      if (key instanceof Error || Array.isArray(key) || !key.isPrivateKey())
        throw fail(messages.INVALID_KEY);
      auth = { type: 'publickey', username: this.connection.username, key };
    } else throw fail('请选择认证方式');
    const cb = this.authCallback;
    this.authCallback = null;
    this.authAttempted = true;
    this.diagnostic('authentication', 'running', '正在验证 SSH 认证信息');
    this.setState('authenticating');
    this.timeout(this.timers.handshake);
    cb(auth);
  }
  input(text: unknown) {
    if (this.state !== 'connected' || typeof text !== 'string' || Buffer.byteLength(text) > 16384)
      throw fail('终端输入无效或会话未连接');
    if (this.stream!.writableLength + Buffer.byteLength(text) > 65536) {
      this.error('OUTPUT_LIMIT');
      return;
    }
    this.stream!.write(text);
  }
  resize(value: unknown) {
    const { cols, rows } = inputRecord(value);
    if (
      typeof cols !== 'number' ||
      !Number.isInteger(cols) ||
      cols < 2 ||
      cols > 500 ||
      typeof rows !== 'number' ||
      !Number.isInteger(rows) ||
      rows < 1 ||
      rows > 300
    )
      throw fail('终端行列数无效');
    this.size = { cols, rows };
    if (this.state === 'connected') this.stream!.setWindow(rows, cols, 0, 0);
  }
  monitor() {
    if (this.state !== 'connected' || this.closed) throw fail('SSH 会话未连接', 409);
    return (this.monitorService ??= new SessionMonitor(this.client!)).read();
  }
  files() {
    if (this.state !== 'connected' || this.closed) throw fail('SSH 会话未连接', 409);
    return (this.fileService ??= new SessionFiles(this.client!, {
      isConnected: () => !this.closed && this.state === 'connected',
      onChannelStatus: (status) =>
        this.diagnostic(
          'sftp',
          status,
          status === 'running'
            ? '正在请求 SFTP 文件服务'
            : status === 'passed'
              ? 'SFTP 文件服务可用'
              : 'SFTP 文件服务不可用；终端连接可继续使用',
        ),
    }));
  }
  close() {
    if (this.closed) return;
    if (this.diagnosticStage)
      this.diagnostic(this.diagnosticStage, 'failed', '连接已结束，该阶段未完成');
    this.closed = true;
    this.fileService?.close();
    this.monitorService?.close();
    clearTimeout(this.timer);
    const hc = this.hostCallback,
      ac = this.authCallback;
    this.hostCallback = null;
    this.authCallback = null;
    try {
      hc?.(false);
      ac?.(false);
    } catch {}
    try {
      this.stream?.close();
      this.client?.destroy();
    } catch {}
    this.stream = null;
    this.client = null;
    this.setState('disconnected');
  }
}
