import type { VncLogEntry, VncLogStage, VncLogLevel } from '../domain/vnc.js';
import { fail } from '../terminal/model.js';
import { errorInfo } from '../errors.js';
interface Record {
  owner: string;
  started: number;
  closedAt?: number;
  serial: number;
  items: VncLogEntry[];
}
/** Short-lived diagnostic tombstones survive socket failure until the owner retrieves them. */
export class VncLogStore {
  private readonly records = new Map<string, Record>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly maxEntries: number;
  constructor(
    options: { now?: () => number; ttlMs?: number; maxSessions?: number; maxEntries?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxSessions = options.maxSessions ?? 128;
    this.maxEntries = options.maxEntries ?? 64;
  }
  create(id: string, owner: string) {
    this.prune();
    while (this.records.size >= this.maxSessions) {
      const oldest =
        [...this.records].find(([, r]) => r.closedAt !== undefined) ??
        this.records.entries().next().value;
      if (!oldest) break;
      this.records.delete(oldest[0]);
    }
    this.records.set(id, { owner, started: this.now(), serial: 0, items: [] });
  }
  append(id: string, stage: VncLogStage, level: VncLogLevel, message: string) {
    const record = this.records.get(id);
    if (!record || record.closedAt !== undefined) return;
    record.items.push({
      id: ++record.serial,
      time: new Date(this.now()).toISOString(),
      elapsedMs: Math.max(0, this.now() - record.started),
      stage,
      level,
      message,
    });
    record.items.splice(0, Math.max(0, record.items.length - this.maxEntries));
  }
  read(owner: string, id: string) {
    this.prune();
    const record = this.records.get(id);
    if (!record || record.owner !== owner) throw fail('会话日志不存在', 404);
    return record.items.map((item) => ({ ...item }));
  }
  close(id: string) {
    const record = this.records.get(id);
    if (record && record.closedAt === undefined) record.closedAt = this.now();
  }
  delete(id: string) {
    this.records.delete(id);
  }
  clear() {
    this.records.clear();
  }
  private prune() {
    for (const [id, record] of this.records)
      if (record.closedAt !== undefined && this.now() - record.closedAt >= this.ttlMs)
        this.records.delete(id);
  }
}
export function vncNetworkError(error: unknown) {
  const code = errorInfo(error).code;
  const reasons: { [key: string]: string } = {
    ECONNREFUSED: '目标拒绝连接，请检查 VNC 服务和端口',
    ETIMEDOUT: '连接超时，请检查路由和防火墙',
    ENOTFOUND: '主机名解析失败',
    EAI_AGAIN: 'DNS 暂时无法解析主机名',
    EHOSTUNREACH: '目标主机不可达',
    ENETUNREACH: '目标网络不可达',
    ECONNRESET: '目标重置连接',
    EACCES: '连接被系统权限策略阻止',
    EPERM: '连接被系统权限策略阻止',
  };
  return code && reasons[code]
    ? `${reasons[code]}（${code}）`
    : '网络连接失败，请检查目标地址及服务状态';
}
