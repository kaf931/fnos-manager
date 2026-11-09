import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import type { RecordValue } from '../domain/record.js';
export type { RecordValue } from '../domain/record.js';
export function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('记录必须是对象');
  return value as RecordValue;
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('字段必须是字符串');
  return value;
}
export function optionalText(value: unknown): string | null {
  return value == null ? null : text(value);
}
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('字段必须是安全整数');
  return value;
}
export function time(value: unknown): number | null {
  if (value == null) return null;
  const result = typeof value === 'string' ? Date.parse(value) : value;
  return integer(result);
}
export function bool(value: unknown, fallback = false): number {
  if (value === undefined) return Number(fallback);
  if (typeof value !== 'boolean') throw new Error('字段必须是布尔值');
  return Number(value);
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('字段必须是数组');
  return value;
}
export function json(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('字段不是有效 JSON');
  return result;
}
export function rest(value: RecordValue, fields: string[]): RecordValue {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
}
/** Column names come exclusively from internal mappings, values are always bound. */
export function insert(
  db: DatabaseSync,
  table: string,
  values: Record<string, SQLInputValue>,
): void {
  const fields = Object.keys(values);
  db.prepare(
    `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
  ).run(...Object.values(values));
}

export function insertIcon(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'icons', iconValues(row, position));
}
export function iconValues(row: RecordValue, position: number): Record<string, SQLInputValue> {
  return {
    id: text(row.id),
    name: text(row.name),
    url: text(row.url),
    mode: text(row.mode),
    container_id: optionalText(row.containerId),
    menu_page: optionalText(row.menuPage),
    icon_source: text(row.iconSource ?? '默认图标'),
    revision: integer(row.revision ?? 1),
    applied_revision: integer(row.appliedRevision ?? 0),
    position,
    updated_at: time(row.updatedAt),
  };
}
export function insertFolder(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'ssh_folders', folderValues(row, position));
}
export function folderValues(row: RecordValue, position: number): Record<string, SQLInputValue> {
  return {
    id: text(row.id),
    owner_uid: text(row.ownerUid),
    scope: text(row.scope),
    name: text(row.name),
    parent_id: optionalText(row.parentId),
    position,
  };
}
export function insertCommand(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'ssh_commands', commandValues(row, position));
}
export function commandValues(row: RecordValue, position: number): Record<string, SQLInputValue> {
  return {
    id: text(row.id),
    owner_uid: text(row.ownerUid),
    name: text(row.name),
    content: text(row.content),
    parent_id: optionalText(row.parentId),
    position,
  };
}
export function insertConnection(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'ssh_connections', connectionValues(row, position));
}
export function connectionValues(
  row: RecordValue,
  position: number,
): Record<string, SQLInputValue> {
  return {
    id: text(row.id),
    owner_uid: text(row.ownerUid),
    name: text(row.name),
    kind: text(row.kind),
    host: text(row.host),
    port: integer(row.port),
    username: text(row.username),
    auth_method: optionalText(row.authMethod),
    credentials: row.credentials == null ? null : json(row.credentials),
    folder_id: optionalText(row.folderId),
    position,
    created_at: time(row.createdAt),
    updated_at: time(row.updatedAt),
  };
}
export function insertHost(db: DatabaseSync, row: RecordValue): void {
  insert(db, 'ssh_known_hosts', hostValues(row));
}
export function hostValues(row: RecordValue): Record<string, SQLInputValue> {
  return {
    owner_uid: text(row.ownerUid),
    host: text(row.host),
    port: integer(row.port),
    algorithm: text(row.algorithm),
    public_key: text(row.key),
    fingerprint: text(row.fingerprint),
  };
}
export function insertWake(db: DatabaseSync, row: RecordValue, position: number): void {
  const control = row.lastControl == null ? null : record(row.lastControl);
  insert(db, 'wake_devices', {
    id: text(row.id),
    owner_uid: text(row.owner),
    name: text(row.name),
    mac: text(row.mac),
    address: text(row.address),
    port: integer(row.port),
    system: text(row.system ?? 'linux'),
    connection_id: optionalText(row.connectionId),
    position,
    created_at: time(row.createdAt),
    updated_at: time(row.updatedAt),
    last_wake_at: time(row.lastSentAt),
    last_power_at: time(control?.sentAt),
    last_power_action: optionalText(control?.action),
  });
}
export const taskFields = [
  'id',
  'ownerUid',
  'name',
  'type',
  'enabled',
  'schedule',
  'timeoutSeconds',
  'nextRunAt',
  'createdAt',
  'updatedAt',
  'deviceIds',
  'deviceTargets',
  'pendingReason',
];
export function insertTask(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'tasks', {
    id: text(row.id),
    owner_uid: optionalText(row.ownerUid),
    name: text(row.name),
    type: text(row.type),
    enabled: bool(row.enabled),
    schedule: json(row.schedule),
    options: json(rest(row, taskFields)),
    timeout: integer(row.timeoutSeconds ?? 300),
    next_run_at: time(row.nextRunAt),
    position,
    created_at: time(row.createdAt),
    updated_at: time(row.updatedAt),
  });
  if (row.deviceIds !== undefined)
    list(row.deviceIds).forEach((id, index) => {
      const target =
        list(row.deviceTargets ?? [])
          .map(record)
          .find((t) => t.id === id) ?? {};
      insert(db, 'task_devices', {
        task_id: text(row.id),
        owner_uid: text(row.ownerUid),
        device_id: text(id),
        selected_device_id: text(id),
        position: index,
        target_snapshot: json(target),
      });
    });
}
export function insertRun(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'task_runs', runValues(row, position));
}
export function runValues(row: RecordValue, position: number): Record<string, SQLInputValue> {
  return {
    id: text(row.id),
    task_id: text(row.taskId),
    task_name: text(row.taskName),
    trigger: text(row.trigger),
    status: text(row.status),
    started_at: time(row.startedAt),
    finished_at: time(row.finishedAt),
    exit_code: row.code == null ? null : integer(row.code),
    stdout: text(row.stdout ?? ''),
    stderr: text(row.stderr ?? ''),
    truncated: bool(row.truncated),
    device_results: row.deviceResults == null ? null : json(row.deviceResults),
    position,
  };
}
export const scanFields = [
  'id',
  'owner',
  'mode',
  'path',
  'status',
  'startedAt',
  'finishedAt',
  'error',
  'result',
  'worker',
];
export const resultCollections = ['catalog', 'largestFiles', 'entries', 'extensions', 'groups'];
export function insertScan(db: DatabaseSync, row: RecordValue, position: number): void {
  const result = row.result == null ? null : record(row.result);
  insert(db, 'scans', {
    id: text(row.id),
    owner_uid: text(row.owner),
    mode: text(row.mode),
    path: text(row.path),
    status: text(row.status),
    created_at: time(row.startedAt),
    finished_at: time(row.finishedAt),
    error: optionalText(row.error),
    limited: Number(row.status === 'limited'),
    statistics: json({
      job: rest(row, scanFields),
      result: result === null ? null : rest(result, resultCollections),
    }),
    position,
  });
  if (!result) return;
  for (const [field, collection] of [
    ['catalog', 'catalog'],
    ['largestFiles', 'largestFiles'],
    ['entries', 'topDirectories'],
    ['extensions', 'extensions'],
  ] as const) {
    list(result[field] ?? []).forEach((value, index) => {
      const item = record(value);
      insert(db, 'scan_entries', {
        scan_id: text(row.id),
        collection,
        position: index,
        name: optionalText(item.name ?? item.extension),
        path: optionalText(item.path),
        type: optionalText(item.type),
        size: integer(item.size ?? item.bytes ?? 0),
        modified_at:
          typeof (item.modifiedAt ?? item.mtime) === 'number'
            ? ((item.modifiedAt ?? item.mtime) as number)
            : null,
        details: json({
          fields: Object.keys(item),
          values: rest(item, ['name', 'path', 'type', 'size', 'mtime', 'modifiedAt']),
        }),
      });
    });
  }
  list(result.groups ?? []).forEach((value, index) => {
    const group = record(value),
      paths = list(group.paths);
    insert(db, 'duplicate_groups', {
      scan_id: text(row.id),
      position: index,
      size: integer(group.size),
      total_count: integer(group.count ?? paths.length),
      paths_truncated: bool(group.pathsTruncated),
    });
    const id = db.prepare('SELECT last_insert_rowid() id').get()?.id;
    if (typeof id !== 'number' && typeof id !== 'bigint') throw new Error('无法保存重复组');
    paths.forEach((entry, i) =>
      insert(db, 'duplicate_members', { group_id: id, position: i, path: text(entry) }),
    );
  });
}
export function insertRename(db: DatabaseSync, row: RecordValue, position: number): void {
  insert(db, 'rename_batches', {
    id: text(row.id),
    owner_uid: text(row.owner),
    path: text(row.path),
    operation: text(row.operation),
    status: text(row.status),
    created_at: time(row.startedAt),
    finished_at: time(row.finishedAt),
    undo_of: optionalText(row.undoOf),
    undone_by: optionalText(row.undoneBy),
    position,
    details: json(
      rest(row, [
        'id',
        'owner',
        'path',
        'operation',
        'status',
        'startedAt',
        'finishedAt',
        'undoOf',
        'undoneBy',
        'entries',
      ]),
    ),
  });
  list(row.entries ?? []).forEach((value, index) => {
    const item = record(value);
    insert(db, 'rename_items', {
      batch_id: text(row.id),
      position: index,
      old_name: optionalText(item.from),
      new_name: optionalText(item.to),
      status: optionalText(item.status),
      details: json(rest(item, ['from', 'to', 'status'])),
    });
  });
}
export function insertOfficial(db: DatabaseSync, row: RecordValue): void {
  insert(db, 'official_connection', {
    id: 1,
    connected: bool(row.connected),
    origin: optionalText(row.origin),
    file_storage: bool(row.fileStorage),
    pending_at: time(row.pending),
    authorization_url: optionalText(row.authorizationUrl),
  });
}
