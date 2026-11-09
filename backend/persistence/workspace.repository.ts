import { CONFIG_LIMITS } from '../domain/config-limits.js';
import type { WorkspaceItem } from '../domain/terminal.js';
import type { DatabaseService } from './database.service.js';
import { commandValues, folderValues, text, type RecordValue } from './records.js';
import { position, upsert } from './sql.js';

export class WorkspaceRepository {
  constructor(private readonly database: DatabaseService) {}
  private decode(row: RecordValue, kind: 'folder' | 'command'): WorkspaceItem {
    const common = {
      id: text(row.id),
      ownerUid: text(row.owner_uid),
      name: text(row.name),
      parentId: row.parent_id == null ? null : text(row.parent_id),
    };
    return kind === 'command'
      ? { ...common, kind, scope: 'commands', content: text(row.content) }
      : { ...common, kind, scope: text(row.scope) as 'assets' | 'commands' };
  }
  list(owner?: string, scope?: 'assets' | 'commands'): WorkspaceItem[] {
    const rows: WorkspaceItem[] = [];
    for (const [table, kind] of [
      ['ssh_folders', 'folder'],
      ['ssh_commands', 'command'],
    ] as const) {
      const conditions: string[] = [],
        params: string[] = [];
      if (owner !== undefined) {
        conditions.push('owner_uid=?');
        params.push(owner);
      }
      if (scope !== undefined) {
        conditions.push('scope=?');
        params.push(scope);
      }
      rows.push(
        ...this.database.connection
          .prepare(
            `SELECT * FROM ${table}${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY position,id`,
          )
          .all(...params)
          .map((row) => this.decode(row, kind)),
      );
    }
    return rows;
  }
  find(owner: string, id: string): WorkspaceItem | undefined {
    for (const [table, kind] of [
      ['ssh_folders', 'folder'],
      ['ssh_commands', 'command'],
    ] as const) {
      const row = this.database.connection
        .prepare(`SELECT * FROM ${table} WHERE owner_uid=? AND id=?`)
        .get(owner, id);
      if (row) return this.decode(row, kind);
    }
    return undefined;
  }
  save(item: WorkspaceItem): void {
    this.database.transaction(() => {
      const table = item.kind === 'folder' ? 'ssh_folders' : 'ssh_commands';
      const opposite = item.kind === 'folder' ? 'ssh_commands' : 'ssh_folders';
      if (this.database.connection.prepare(`SELECT 1 FROM ${opposite} WHERE id=?`).get(item.id))
        throw new Error('条目类型不能修改');
      const old = this.database.connection
        .prepare(`SELECT owner_uid,scope FROM ${table} WHERE id=?`)
        .get(item.id);
      if (old && (old.owner_uid !== item.ownerUid || old.scope !== item.scope))
        throw new Error('所属用户与类型不能修改');
      let parent = item.parentId,
        depth = item.kind === 'folder' ? 1 : 0;
      const seen = new Set([item.id]);
      while (parent) {
        if (seen.has(parent)) throw new Error('目录不能循环嵌套');
        seen.add(parent);
        const row = this.database.connection
          .prepare('SELECT parent_id FROM ssh_folders WHERE owner_uid=? AND scope=? AND id=?')
          .get(item.ownerUid, item.scope, parent);
        if (!row) throw new Error('所属目录不存在');
        if (++depth > CONFIG_LIMITS.folderDepth) throw new Error('目录最多 16 层');
        parent = row.parent_id == null ? null : text(row.parent_id);
      }
      const values =
        item.kind === 'folder'
          ? folderValues({ ...item }, position(this.database.connection, table, item.id))
          : commandValues({ ...item }, position(this.database.connection, table, item.id));
      upsert(this.database.connection, table, values);
    });
  }
  hasVncChildren(owner: string, id: string): boolean {
    return !!this.database.connection
      .prepare(
        'SELECT id FROM vnc_connections WHERE owner_uid=? AND folder_id=? UNION ALL SELECT id FROM rdp_connections WHERE owner_uid=? AND folder_id=? UNION ALL SELECT id FROM adb_connections WHERE owner_uid=? AND folder_id=? LIMIT 1',
      )
      .get(owner, id, owner, id, owner, id);
  }
  remove(owner: string, id: string): void {
    this.database.transaction(() => {
      this.database.connection
        .prepare('DELETE FROM ssh_commands WHERE owner_uid=? AND id=?')
        .run(owner, id);
      this.database.connection
        .prepare('DELETE FROM ssh_folders WHERE owner_uid=? AND id=?')
        .run(owner, id);
    });
  }
}
