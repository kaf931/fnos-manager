import { validateAdbConnection } from '../adb/model.js';
import { validateRdpConnection } from '../rdp/model.js';
import { validateVncConnection } from '../vnc/model.js';
import sharp from 'sharp';
import { validateEntry } from '../core.js';
import { AI_PROTOCOLS } from '../domain/ai.js';
import { CONFIG_LIMITS } from '../domain/config-limits.js';
import { menuPages } from '../domain/icons.js';
import type { BackupItem, BackupKind, BackupPackage } from '../domain/backup.js';
import { decodeStoredCredentials } from '../domain/terminal.js';
import { DomainError, inputRecord } from '../errors.js';
import { validateConnection } from '../terminal/model.js';
import { validateCredentials } from '../terminal/credentials.js';
import { normalizeAiUrl } from '../terminal/ai/settings.js';
import { validateDevice } from '../wol.js';
import { validateTask, TYPE_INFO, DEVICE_TASK_ACTIONS } from '../tasks/model.js';
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const fields: Record<BackupKind, readonly string[]> = {
  adb: ['name', 'protocol', 'host', 'port', 'folderId', 'deviceType', 'serial'],
  rdp: [
    'name',
    'protocol',
    'host',
    'port',
    'username',
    'password',
    'domain',
    'security',
    'certificatePolicy',
    'folderId',
  ],
  vnc: ['name', 'protocol', 'host', 'port', 'username', 'password', 'folderId'],
  icons: ['name', 'url', 'mode', 'containerId', 'menuPage', 'iconSource', 'image'],
  folders: ['name', 'scope', 'parentId'],
  connections: [
    'name',
    'kind',
    'host',
    'port',
    'username',
    'folderId',
    'authMethod',
    'credentials',
  ],
  shortcuts: ['name', 'parentId', 'content'],
  commands: ['command', 'description', 'category'],
  devices: ['name', 'mac', 'address', 'ip', 'port', 'system', 'connectionId'],
  providers: ['name', 'protocol', 'baseUrl', 'model', 'apiKey'],
  preferences: [
    'theme',
    'palette',
    'terminalBackground',
    'commandHints',
    'defaultPage',
    'navigationMotion',
  ],
  tasks: [
    'name',
    'type',
    'schedule',
    'timeoutSeconds',
    'retryCount',
    'missedPolicy',
    'action',
    'target',
    'script',
    'level',
    'module',
    'deviceIds',
  ],
};
export function exact(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const row = inputRecord(value, '配置格式无效');
  if (Object.keys(row).some((key) => !allowed.includes(key)))
    throw new DomainError('配置含有非法字段');
  return row;
}
export function str(value: unknown, max = 80, empty = false): string {
  if (
    typeof value !== 'string' ||
    (!empty && !value.trim()) ||
    value.length > max ||
    value.includes('\0')
  )
    throw new DomainError('配置字符串格式或长度无效');
  return value;
}
function name(value: unknown, max = 80) {
  const n = str(value, max);
  if (n !== n.trim() || /[\x00-\x1f\x7f]/.test(n)) throw new DomainError('配置名称无效');
  return n;
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new DomainError('配置枚举无效');
  return value as T;
}
function reference(value: unknown): string | null {
  return value == null ? null : str(value, 64);
}
export function key(item: Pick<BackupItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}
export function dependencies(item: BackupItem): string[] {
  const d = item.data;
  if ((item.kind === 'folders' || item.kind === 'shortcuts') && d.parentId)
    return [`folders:${d.parentId}`];
  if (
    (item.kind === 'connections' ||
      item.kind === 'vnc' ||
      item.kind === 'rdp' ||
      item.kind === 'adb') &&
    d.folderId
  )
    return [`folders:${d.folderId}`];
  if (item.kind === 'devices' && d.connectionId) return [`connections:${d.connectionId}`];
  if (item.kind === 'tasks' && Array.isArray(d.deviceIds))
    return d.deviceIds.map((id) => `devices:${id}`);
  return [];
}
export function itemName(item: BackupItem): string {
  return String(item.data.name ?? item.data.command ?? '使用偏好');
}
export function pendingReason(item: BackupItem): string | undefined {
  if (item.kind !== 'tasks') return;
  const info = TYPE_INFO.find((t) => t.id === item.data.type);
  if (item.data.type === 'device-reboot' || item.data.type === 'device-shutdown')
    return '恢复后请编辑任务，重新确认设备与 SSH 电源控制目标';
  if (info?.support === 'oauth') return '恢复后请重新授权并编辑确认任务';
  if (['script', 'docker', 'app'].includes(String(item.data.type)))
    return '恢复后请编辑任务，核对本机路径、程序或容器目标';
  return;
}
export function normalizeItem(item: BackupItem): BackupItem {
  const d = exact(item.data, fields[item.kind]);
  let data: Record<string, unknown>;
  switch (item.kind) {
    case 'adb': {
      data = { ...validateAdbConnection(d), folderId: reference(d.folderId) };
      break;
    }
    case 'rdp': {
      data = { ...validateRdpConnection(d), folderId: reference(d.folderId) };
      break;
    }
    case 'vnc': {
      data = { ...validateVncConnection(d), folderId: reference(d.folderId) };
      break;
    }
    case 'connections': {
      data = { ...validateConnection(d), folderId: reference(d.folderId) };
      if (d.authMethod !== undefined || d.credentials !== undefined) {
        const method = choice(d.authMethod, ['password', 'privateKey']);
        exact(
          d.credentials,
          method === 'password' ? ['method', 'password'] : ['method', 'privateKey', 'passphrase'],
        );
        data.authMethod = method;
        try {
          data.credentials = validateCredentials(
            method,
            decodeStoredCredentials(method, d.credentials),
          );
        } catch {
          throw new DomainError('SSH 凭据格式无效');
        }
      }
      break;
    }
    case 'devices':
      data = { ...validateDevice(d) };
      break;
    case 'folders':
      data = {
        name: name(d.name),
        scope: choice(d.scope, ['assets', 'commands']),
        parentId: reference(d.parentId),
      };
      break;
    case 'shortcuts': {
      const content = str(d.content, 16384);
      if (
        Buffer.byteLength(content) > 16384 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(content)
      )
        throw new DomainError('快捷指令格式无效');
      data = { name: name(d.name), parentId: reference(d.parentId), content };
      break;
    }
    case 'commands':
      data = {
        command: name(d.command, 300),
        description: str(d.description, 300),
        category: str(d.category, 40),
      };
      break;
    case 'providers': {
      const apiKey = str(d.apiKey ?? '', 8192, true);
      if (/[\r\n]/.test(apiKey)) throw new DomainError('API Key 格式无效');
      data = {
        name: name(d.name),
        protocol: choice(d.protocol, AI_PROTOCOLS),
        baseUrl: normalizeAiUrl(str(d.baseUrl, 2048)),
        model: str(d.model, 200),
        apiKey,
      };
      break;
    }
    case 'preferences':
      if (typeof d.commandHints !== 'boolean' || typeof d.navigationMotion !== 'boolean')
        throw new DomainError('偏好格式无效');
      data = {
        theme: choice(d.theme, ['system', 'light', 'dark']),
        palette: choice(d.palette ?? 'classic', ['classic', 'mist', 'teal', 'default']),
        terminalBackground: choice(d.terminalBackground ?? 'striped', ['striped', 'solid']),
        commandHints: d.commandHints,
        defaultPage: choice(d.defaultPage, ['icons', 'tasks', 'terminal', 'storage', 'wake']),
        navigationMotion: d.navigationMotion,
      };
      break;
    case 'icons': {
      const url = str(d.url, 2048, true),
        menuPage = d.menuPage == null ? null : choice(d.menuPage, menuPages);
      data = {
        ...validateEntry({
          name: name(d.name, 40),
          url,
          mode: choice(d.mode, ['iframe', 'url']),
          containerId: d.containerId == null ? null : str(d.containerId, 128),
          menuPage,
        }),
        iconSource: str(d.iconSource ?? '默认图标', 200),
      };
      if (d.image !== undefined) data.image = str(d.image, Math.ceil(2097152 / 3) * 4);
      break;
    }
    case 'tasks': {
      const schedule = exact(d.schedule, ['kind', 'time', 'days', 'minutes', 'at']);
      if (typeof d.timeoutSeconds !== 'number' || !Number.isInteger(d.timeoutSeconds))
        throw new DomainError('任务超时必须为整数');
      str(d.name, 60);
      str(d.type, 40);
      const scheduleFields: Record<string, string[]> = {
        daily: ['kind', 'time'],
        weekly: ['kind', 'time', 'days'],
        interval: ['kind', 'minutes'],
        once: ['kind', 'at'],
      };
      exact(schedule, scheduleFields[String(schedule.kind)] ?? []);
      if (schedule.kind === 'once') str(schedule.at, 40);
      if (schedule.kind === 'weekly' && (!Array.isArray(schedule.days) || schedule.days.length > 7))
        throw new DomainError('任务每周计划无效');
      const taskFields = [
        'name',
        'type',
        'schedule',
        'timeoutSeconds',
        'retryCount',
        'missedPolicy',
      ];
      if (d.type === 'script') taskFields.push('script');
      if (d.type === 'app' || d.type === 'docker') taskFields.push('action', 'target');
      if (d.type === 'log-clear') {
        taskFields.push('level', 'module');
        if (typeof d.level !== 'number' || typeof d.module !== 'number')
          throw new DomainError('任务日志参数必须为整数');
      }
      if (DEVICE_TASK_ACTIONS[String(d.type)]) taskFields.push('deviceIds');
      exact(d, taskFields);
      // Validation-only targets satisfy the existing task validator. They are never stored or returned.
      const deviceIds = Array.isArray(d.deviceIds) ? d.deviceIds : [];
      const valid = validateTask({
        ...d,
        schedule,
        enabled: false,
        acknowledged: true,
        ownerUid: 'development',
        deviceTargets: deviceIds.map((id) => ({
          id,
          connectionId: 'validation',
          host: 'validation',
          port: 22,
          username: 'validation',
          system: 'linux',
        })),
      });
      data = { ...valid };
      delete data.enabled;
      delete data.acknowledged;
      delete data.ownerUid;
      delete data.deviceTargets;
      if (!DEVICE_TASK_ACTIONS[valid.type] && d.deviceIds !== undefined)
        throw new DomainError('非设备任务不能关联设备');
      break;
    }
  }
  return { kind: item.kind, id: item.id, data };
}
export async function validateBackup(value: unknown): Promise<BackupPackage> {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_BACKUP_BYTES)
    throw new DomainError('配置包不能超过 32 MiB', 413);
  const raw = exact(value, [
    'format',
    'version',
    'exportedAt',
    'appVersion',
    'includeCredentials',
    'items',
  ]);
  if (raw.format !== 'fnos-manager-config' || raw.version !== 1)
    throw new DomainError('不支持的配置包格式或版本');
  const exportedAt = str(raw.exportedAt, 40),
    appVersion = str(raw.appVersion, 80);
  if (
    !Number.isFinite(Date.parse(exportedAt)) ||
    typeof raw.includeCredentials !== 'boolean' ||
    !Array.isArray(raw.items) ||
    raw.items.length > 4000
  )
    throw new DomainError('配置包字段或数量无效');
  const items = raw.items.map((v: unknown) => {
    const r = exact(v, ['kind', 'id', 'data']),
      kind = choice(r.kind, Object.keys(fields) as BackupKind[]),
      id = str(r.id, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new DomainError('配置 ID 无效');
    return normalizeItem({ kind, id, data: inputRecord(r.data) });
  });
  const seen = new Map<string, BackupItem>();
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new DomainError('配置 ID 重复');
  for (const item of items) {
    if (seen.has(key(item))) throw new DomainError('配置 ID 重复');
    seen.set(key(item), item);
  }
  if (items.filter((i) => i.kind === 'preferences').length > 1)
    throw new DomainError('偏好只能有一份');
  for (const item of items) {
    for (const dep of dependencies(item)) {
      const target = seen.get(dep);
      if (!target) throw new DomainError('配置存在悬空依赖');
      if (item.kind === 'devices' && target.kind === 'connections' && target.data.kind !== 'remote')
        throw new DomainError('设备只能关联远程 SSH 连接');
      if (target.kind === 'folders') {
        const scope =
          item.kind === 'connections' ||
          item.kind === 'vnc' ||
          item.kind === 'rdp' ||
          item.kind === 'adb'
            ? 'assets'
            : item.kind === 'shortcuts'
              ? 'commands'
              : item.data.scope;
        if (target.data.scope !== scope) throw new DomainError('目录范围不匹配');
      }
    }
    if (item.kind === 'folders') {
      let cursor: BackupItem | undefined = item;
      const chain = new Set<string>();
      while (cursor) {
        if (chain.has(cursor.id)) throw new DomainError('目录循环');
        chain.add(cursor.id);
        if (chain.size > CONFIG_LIMITS.folderDepth) throw new DomainError('目录最多 16 层');
        cursor = cursor.data.parentId ? seen.get(`folders:${cursor.data.parentId}`) : undefined;
      }
    }
    if (
      !raw.includeCredentials &&
      ((item.kind === 'connections' && item.data.credentials) ||
        ((item.kind === 'vnc' || item.kind === 'rdp') && item.data.password) ||
        (item.kind === 'providers' && item.data.apiKey))
    )
      throw new DomainError('配置包凭据声明不一致');
    if (item.kind === 'icons' && item.data.image) {
      const encoded = String(item.data.image),
        image = Buffer.from(encoded, 'base64');
      if (image.length > 2097152 || image.toString('base64') !== encoded)
        throw new DomainError('图标图片大小或编码无效');
      try {
        const decoded = sharp(image, { limitInputPixels: 16777216 });
        const meta = await decoded.metadata();
        if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages && meta.pages > 1))
          throw Error();
        const png = await decoded.png().toBuffer();
        if (png.length > 2097152) throw Error();
        item.data.image = png.toString('base64');
      } catch {
        throw new DomainError('图标仅支持有效的 PNG、JPEG、WebP 静态图片（最多 2 MiB）');
      }
    }
  }
  return {
    format: 'fnos-manager-config',
    version: 1,
    exportedAt,
    appVersion,
    includeCredentials: raw.includeCredentials,
    items,
  };
}
