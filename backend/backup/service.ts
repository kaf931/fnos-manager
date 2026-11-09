import { OperationRepository } from '../persistence/operation.repository.js';
import { createHash, randomBytes } from 'node:crypto';
import {
  BACKUP_MODULES,
  type BackupModule,
  type BackupItem,
  type BackupPackage,
  type BackupPreview,
  type BackupDecision,
  type RestoreResult,
} from '../domain/backup.js';
import { CONFIG_LIMITS } from '../domain/config-limits.js';
import { DomainError } from '../errors.js';
import type { DatabaseService } from '../persistence/database.service.js';
import { BackupRepository } from '../persistence/backup.repository.js';
import {
  dependencies,
  exact,
  itemName,
  key,
  normalizeItem,
  pendingReason,
  str,
  validateBackup,
  MAX_BACKUP_BYTES,
} from './validation.js';
interface PreviewState {
  owner: string;
  backup: BackupPackage;
  preview: BackupPreview;
  expires: number;
  bytes: number;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function moduleOf(item: BackupItem): BackupModule {
  switch (item.kind) {
    case 'connections':
    case 'vnc':
    case 'rdp':
    case 'adb':
      return 'ssh';
    case 'folders':
      return item.data.scope === 'assets' ? 'ssh' : 'commands';
    case 'shortcuts':
    case 'commands':
      return 'commands';
    case 'devices':
      return 'wake';
    case 'providers':
      return 'ai';
    default:
      return item.kind;
  }
}
function compatible(a: BackupItem, b: BackupItem): boolean {
  return (
    a.kind === b.kind &&
    ((a.kind === 'connections' && a.data.kind === b.data.kind) ||
      a.kind === 'vnc' ||
      a.kind === 'rdp' ||
      a.kind === 'adb' ||
      (a.kind === 'devices' && a.data.system === b.data.system) ||
      (a.kind === 'folders' && a.data.scope === b.data.scope))
  );
}
function collision(a: BackupItem, b: BackupItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'preferences') return true;
  if (a.kind === 'folders')
    return (
      a.data.scope === b.data.scope &&
      (a.data.parentId ?? null) === (b.data.parentId ?? null) &&
      a.data.name === b.data.name
    );
  if (a.kind === 'commands') return a.data.command === b.data.command;
  return a.data.name === b.data.name;
}
export class BackupService {
  readonly repository: BackupRepository;
  readonly audit: OperationRepository;
  private readonly previews = new Map<string, PreviewState>();
  constructor(
    database: DatabaseService,
    private readonly appVersion: string,
  ) {
    this.repository = new BackupRepository(database);
    this.audit = new OperationRepository(database);
  }
  async export(
    owner: string,
    input: { modules: BackupModule[]; includeCredentials: boolean },
  ): Promise<BackupPackage> {
    if (
      !Array.isArray(input.modules) ||
      !input.modules.length ||
      input.modules.some((m) => !BACKUP_MODULES.includes(m)) ||
      typeof input.includeCredentials !== 'boolean'
    )
      throw new DomainError('请选择有效的备份范围');
    const all = this.repository.transaction(() => this.repository.snapshot(owner)),
      selected = new Map<string, BackupItem>();
    const visit = (item: BackupItem) => {
      if (selected.has(key(item))) return;
      selected.set(key(item), item);
      for (const dep of dependencies(item)) {
        const target = all.find((i) => key(i) === dep);
        if (!target) throw new DomainError(`${itemName(item)} 的依赖已失效，请先编辑修复`);
        visit(target);
      }
    };
    all.filter((i) => input.modules.includes(moduleOf(i))).forEach(visit);
    const items = Array.from(selected.values()).map((item) => {
      const result = structuredClone(item);
      if (!input.includeCredentials) {
        if (item.kind === 'connections') {
          delete result.data.authMethod;
          delete result.data.credentials;
        }
        if (item.kind === 'vnc' || item.kind === 'rdp') result.data.password = '';
        if (item.kind === 'providers') result.data.apiKey = '';
      }
      return result;
    });
    const pkg: BackupPackage = {
      format: 'fnos-manager-config',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: this.appVersion,
      includeCredentials: input.includeCredentials,
      items,
    };
    if (Buffer.byteLength(JSON.stringify(pkg)) > MAX_BACKUP_BYTES)
      throw new DomainError('配置包超过 32 MiB，请分模块导出', 413);
    return validateBackup(pkg);
  }
  async preview(owner: string, value: unknown): Promise<BackupPreview> {
    const backup = await validateBackup(value);
    this.checkLimits(backup.items, [], 0, 0);
    const state = this.repository.transaction(() => this.repository.configurationState(owner)),
      existing = state.items;
    const ancestors = (item: BackupItem, rows: BackupItem[]): string => {
      const p = item.data.parentId;
      if (!p) return '';
      const parent = rows.find((i) => i.kind === 'folders' && i.id === p);
      return parent ? ancestors(parent, rows) + '/' + String(parent.data.name) : '/missing';
    };
    const rows = backup.items.map((item) => {
      const peers = [...existing, ...backup.items.filter((i) => i !== item)];
      const conflict = peers.some((other) =>
        item.kind === 'folders' && other.kind === 'folders'
          ? item.data.name === other.data.name &&
            item.data.scope === other.data.scope &&
            ancestors(item, backup.items) ===
              ancestors(other, existing.includes(other) ? existing : backup.items)
          : collision(item, other),
      );
      const warnings: string[] = [];
      if (item.kind === 'connections' && item.data.kind === 'local')
        warnings.push('本机连接将连接恢复后的目标 NAS');
      if (item.kind === 'connections' && !item.data.credentials)
        warnings.push('未保存认证，连接前需补填凭据');
      if (item.kind === 'icons') warnings.push('恢复后未安装到桌面，需重新添加');
      if (item.kind === 'tasks')
        warnings.push('任务恢复后暂停', pendingReason(item) ?? '请检查计划与设备');
      if (item.kind === 'icons' && item.data.containerId) warnings.push('容器标识需在本机重新核对');
      return {
        key: key(item),
        kind: item.kind,
        id: item.id,
        name: itemName(item),
        conflict,
        defaultAction:
          conflict || item.kind === 'preferences' ? ('skip' as const) : ('import' as const),
        dependencies: dependencies(item),
        candidates: existing
          .filter((other) => compatible(item, other))
          .map((i) => ({ id: i.id, name: itemName(i) })),
        warnings,
      };
    });
    const token = randomBytes(32).toString('hex'),
      expires = Date.now() + 15 * 60 * 1000;
    const preview: BackupPreview = {
      token,
      expiresAt: new Date(expires).toISOString(),
      packageDigest: digest(backup),
      configDigest: digest(state),
      counts: Object.fromEntries(
        [...new Set(rows.map((r) => r.kind))].map((kind) => [
          kind,
          rows.filter((r) => r.kind === kind).length,
        ]),
      ),
      warnings: [
        '仅合并配置，不迁移 NAS 实际文件、历史、主机信任或官方授权。',
        '脚本与快捷指令可能含自行填写的秘密。',
      ],
      rows,
    };
    for (const [t, p] of this.previews) if (p.expires < Date.now()) this.previews.delete(t);
    if ([...this.previews.values()].filter((p) => p.owner === owner).length >= 8)
      throw new DomainError('预览过多，请等待旧预览过期', 429);
    const bytes =
      Buffer.byteLength(JSON.stringify(backup)) + Buffer.byteLength(JSON.stringify(preview));
    const retainedBytes = [...this.previews.values()].reduce((sum, p) => sum + p.bytes, 0);
    if (retainedBytes + bytes > 64 * 1024 * 1024)
      throw new DomainError('预览存储容量达到上限，请等待旧预览过期后重试', 429);
    this.previews.set(token, { owner, backup, preview, expires, bytes });
    return preview;
  }
  private checkLimits(
    items: BackupItem[],
    existing: BackupItem[],
    totalTasks: number,
    totalDevices: number,
  ): void {
    const count = (kind: BackupItem['kind'], rows: BackupItem[]) =>
      rows.filter((i) => i.kind === kind).length;
    for (const [kind, limit] of [
      ['connections', CONFIG_LIMITS.connections],
      ['vnc', 200],
      ['rdp', 200],
      ['adb', 200],
      ['devices', CONFIG_LIMITS.devices],
      ['providers', CONFIG_LIMITS.providers],
    ] as const)
      if (count(kind, items) + count(kind, existing) > limit)
        throw new DomainError(`合并后 ${kind} 超过数量上限 ${limit}`);
    if (
      count('folders', items) +
        count('shortcuts', items) +
        count('folders', existing) +
        count('shortcuts', existing) >
      CONFIG_LIMITS.workspace
    )
      throw new DomainError('合并后目录和快捷指令超过 1000 条');
    if (count('tasks', items) + totalTasks > CONFIG_LIMITS.tasks)
      throw new DomainError('合并后任务超过 100 条');
    if (count('devices', items) + totalDevices > CONFIG_LIMITS.totalDevices)
      throw new DomainError('合并后全局设备超过 500 台');
  }
  async restore(
    owner: string,
    input: { token: string; requestId: string; decisions: BackupDecision[] },
  ): Promise<RestoreResult> {
    str(input.token, 128);
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId)) throw new DomainError('请求 ID 无效');
    if (!Array.isArray(input.decisions) || input.decisions.length > 4000)
      throw new DomainError('恢复选择无效');
    const decisions = input.decisions.map((v) => {
      const r = exact(v, ['key', 'action', 'name', 'targetId']);
      str(r.key, 100);
      if (!['skip', 'import', 'map'].includes(String(r.action)))
        throw new DomainError('恢复操作无效');
      if (r.name !== undefined) str(r.name, 300);
      if (r.targetId !== undefined) str(r.targetId, 64);
      return r as unknown as BackupDecision;
    });
    if (new Set(decisions.map((d) => d.key)).size !== decisions.length)
      throw new DomainError('恢复选择重复');
    const requestDigest = digest({
      token: input.token,
      decisions: [...decisions].sort((a, b) => a.key.localeCompare(b.key)),
    });
    const repeat = () => {
      const saved = this.repository.receipt(owner, input.requestId);
      if (saved && saved.digest !== requestDigest)
        throw new DomainError('相同请求 ID 不能用于不同恢复内容', 409);
      return saved?.result;
    };
    const saved = repeat();
    if (saved) return saved;
    const p = this.previews.get(input.token);
    if (!p || p.owner !== owner || p.expires < Date.now())
      throw new DomainError('预览已过期，请重新预览', 409);
    const backup = await validateBackup(p.backup);
    if (digest(backup) !== p.preview.packageDigest)
      throw new DomainError('配置包发生变化，请重新预览', 409);
    if (decisions.some((d) => !p.preview.rows.some((r) => r.key === d.key)))
      throw new DomainError('恢复选择含未知条目');
    return this.repository.transaction(() => {
      const saved = repeat();
      if (saved) return saved;
      const state = this.repository.configurationState(owner);
      if (digest(state) !== p.preview.configDigest)
        throw new DomainError('当前配置发生变化，请重新预览', 409);
      const current = state.items,
        planned: BackupItem[] = [],
        resolved = new Map<string, string>(),
        visiting = new Set<string>(),
        usedTargets = new Set<string>();
      const result: RestoreResult = {
        imported: 0,
        skipped: 0,
        mapped: 0,
        requestId: input.requestId,
      };
      const handled = new Set<string>();
      const visit = (item: BackupItem): void => {
        const k = key(item);
        if (handled.has(k)) return;
        if (visiting.has(k)) throw new DomainError('循环依赖');
        visiting.add(k);
        const row = p.preview.rows.find((r) => r.key === k)!;
        const decision = decisions.find((d) => d.key === k) ?? {
          key: k,
          action: row.defaultAction,
        };
        if (decision.action === 'skip') {
          result.skipped++;
          handled.add(k);
          visiting.delete(k);
          return;
        }
        if (decision.action === 'map') {
          const target = current.find((i) => i.id === decision.targetId && compatible(item, i));
          if (!target) throw new DomainError(`${row.name} 的映射目标不可用`);
          if (usedTargets.has(key(target))) throw new DomainError('多个配置不能映射到同一对象');
          usedTargets.add(key(target));
          resolved.set(k, target.id);
          result.mapped++;
          handled.add(k);
          visiting.delete(k);
          return;
        }
        for (const dep of dependencies(item)) {
          const dependency = backup.items.find((i) => key(i) === dep)!;
          visit(dependency);
          if (!resolved.has(dep))
            throw new DomainError(`${row.name} 的依赖被跳过，请明确映射已有对象或跳过此条目`);
        }
        const copied = structuredClone(item);
        copied.id = this.repository.newId(item.kind);
        if (decision.name !== undefined) {
          if (item.kind === 'commands' || item.kind === 'preferences')
            throw new DomainError('常用命令和偏好不能通过改名复制');
          copied.data.name = decision.name;
        }
        if (copied.data.parentId)
          copied.data.parentId = resolved.get(`folders:${copied.data.parentId}`);
        if (copied.data.folderId)
          copied.data.folderId = resolved.get(`folders:${copied.data.folderId}`);
        if (copied.data.connectionId)
          copied.data.connectionId = resolved.get(`connections:${copied.data.connectionId}`);
        if (Array.isArray(copied.data.deviceIds))
          copied.data.deviceIds = copied.data.deviceIds.map((id) => resolved.get(`devices:${id}`));
        const normalized = normalizeItem(copied);
        if (
          item.kind !== 'preferences' &&
          [...current, ...planned].some((other) => collision(normalized, other))
        )
          throw new DomainError(`${itemName(normalized)} 已存在，请重命名或跳过`, 409);
        planned.push(normalized);
        resolved.set(k, normalized.id);
        result.imported++;
        handled.add(k);
        visiting.delete(k);
      };
      backup.items.forEach(visit);
      this.checkLimits(planned, current, state.totalTasks, state.totalDevices);
      // Recheck the final dependency graph, including explicitly mapped existing devices.
      const merged = [...current, ...planned];
      for (const item of merged.filter(
        (i) =>
          i.kind === 'devices' && (planned.includes(i) || [...resolved.values()].includes(i.id)),
      )) {
        if (!item.data.connectionId) continue;
        const connection = merged.find(
          (i) => i.kind === 'connections' && i.id === item.data.connectionId,
        );
        if (!connection || connection.data.kind !== 'remote')
          throw new DomainError('设备只能关联远程 SSH 连接');
      }
      const operationId = this.audit.begin(owner, 'backup.restore', '配置合并恢复');
      for (const item of planned) this.repository.write(owner, item);
      this.repository.saveReceipt(
        owner,
        input.requestId,
        requestDigest,
        p.preview.packageDigest,
        digest(
          p.preview.rows
            .map(
              (row) =>
                decisions.find((d) => d.key === row.key) ?? {
                  key: row.key,
                  action: row.defaultAction,
                },
            )
            .sort((a, b) => a.key.localeCompare(b.key)),
        ),
        result,
      );
      this.audit.finish(
        operationId,
        owner,
        'success',
        `导入 ${result.imported}，跳过 ${result.skipped}，映射 ${result.mapped}`,
      );
      return result;
    });
  }
}
