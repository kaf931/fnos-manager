import { chmod, link, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { DatabaseService } from '../persistence/database.service.js';
import {
  insertCommand,
  insertConnection,
  insertFolder,
  insertHost,
  insertIcon,
  insertOfficial,
  insertRename,
  insertRun,
  insertScan,
  insertTask,
  insertWake,
  record,
  text,
  type RecordValue,
} from '../persistence/records.js';
import { convertLegacyCredentials } from './legacy-credentials.js';

export interface UpgradeReport {
  sourceVersion: 1;
  targetVersion: 5;
  rows: Record<string, number>;
}
/** Offline conversion only. Source is opened read-only; target is published exclusively after validation. */
export async function upgradeDatabase(
  sourcePath: string,
  destinationPath: string,
  options: { credentialKeyPath?: string } = {},
): Promise<UpgradeReport> {
  const parent = path.dirname(destinationPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(parent, '.upgrade-'));
  let source: DatabaseSync | undefined;
  let snapshot: DatabaseSync | undefined;
  let target: DatabaseService | undefined;
  const counts: Record<string, number> = {};
  try {
    source = new DatabaseSync(sourcePath, { readOnly: true });
    if (source.prepare('PRAGMA user_version').get()?.user_version !== 1)
      throw new Error('升级工具只接受版本 1 数据库');
    const copy = path.join(staging, 'source.sqlite');
    await backup(source, copy);
    source.close();
    source = undefined;
    snapshot = new DatabaseSync(copy, { readOnly: true });
    target = new DatabaseService(staging);
    const db = target.connection;
    const rows = (table: string): RecordValue[] => {
      if (
        !snapshot
          ?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        return [];
      const values = snapshot.prepare(`SELECT id,payload FROM ${table} ORDER BY position`).all();
      return values.map((value) => {
        try {
          return record(JSON.parse(text(value.payload)));
        } catch {
          throw new Error(`旧记录格式无效：${table}/${String(value.id)}`);
        }
      });
    };
    target.transaction(() => {
      const apply = (
        table: string,
        items: RecordValue[],
        save: (db: DatabaseSync, row: RecordValue, position: number) => void,
      ) => {
        items.forEach((row, index) => {
          try {
            save(db, row, index);
          } catch {
            throw new Error(
              `记录转换失败：${table}/${String(row.id ?? row.host ?? index)}，请检查字段或关联`,
            );
          }
        });
        counts[table] = (counts[table] ?? 0) + items.length;
      };
      const workspace = rows('ssh_workspace');
      const folders = workspace.filter((row) => row.kind === 'folder');
      const byId = new Map(folders.map((row) => [text(row.id), row]));
      for (const folder of folders) {
        const visited = new Set<string>();
        let current: RecordValue | undefined = folder,
          depth = 0;
        while (current) {
          const id = text(current.id);
          if (visited.has(id) || ++depth > 16)
            throw new Error(`目录循环或超过 16 层：ssh_folders/${text(folder.id)}`);
          visited.add(id);
          current = current.parentId == null ? undefined : byId.get(text(current.parentId));
        }
      }
      // Deferred references allow arbitrary original ordering; foreign keys validate ownership.

      apply(
        'ssh_folders',
        workspace.filter((row) => row.kind === 'folder'),
        insertFolder,
      );
      apply(
        'ssh_commands',
        workspace.filter((row) => row.kind === 'command'),
        insertCommand,
      );
      if (workspace.some((row) => !['folder', 'command'].includes(String(row.kind))))
        throw new Error('工作区含未知条目类型');
      apply('icons', rows('icons'), insertIcon);
      apply('ssh_connections', rows('ssh_connections'), (db, row, index) =>
        insertConnection(
          db,
          convertLegacyCredentials(
            row,
            options.credentialKeyPath ??
              path.join(path.dirname(sourcePath), 'terminal', 'credential.key'),
          ),
          index,
        ),
      );
      apply('ssh_known_hosts', rows('ssh_known_hosts'), insertHost);
      apply('wake_devices', rows('wake_devices'), insertWake);
      apply('tasks', rows('tasks'), insertTask);
      apply('task_runs', rows('task_runs'), insertRun);
      apply('scans', rows('scan_history'), insertScan);
      apply('rename_batches', rows('rename_history'), insertRename);
      const official = snapshot
        ?.prepare('SELECT metadata FROM documents WHERE path=?')
        .get('official/connection.json');
      if (official) insertOfficial(db, record(JSON.parse(text(official.metadata))));
      const invalid = db.prepare('PRAGMA foreign_key_check').all();
      if (invalid.length)
        throw new Error(
          `数据库存在无效关联：${String(invalid[0].table)}/${String(invalid[0].rowid)}`,
        );
    });
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw new Error('升级后数据库完整性检查失败');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    target.close();
    target = undefined;
    snapshot.close();
    snapshot = undefined;
    const output = path.join(staging, 'nas-manager.sqlite');
    await chmod(output, 0o600);
    // link is exclusive: a repeated run can never overwrite an existing destination.
    try {
      await link(output, destinationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('目标数据库已存在，请使用新的目标路径', { cause: error });
      throw error;
    }
    return { sourceVersion: 1, targetVersion: 5, rows: counts };
  } finally {
    source?.close();
    snapshot?.close();
    target?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
