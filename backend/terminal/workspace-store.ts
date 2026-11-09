import { CONFIG_LIMITS } from '../domain/config-limits.js';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceItem } from '../domain/terminal.js';
import { inputRecord } from '../errors.js';
import { DatabaseService } from '../persistence/database.service.js';
import { WorkspaceRepository } from '../persistence/workspace.repository.js';
import { fail } from './model.js';
import type { TerminalStore } from './store.js';
export class WorkspaceStore {
  readonly dir: string;
  readonly repository: WorkspaceRepository;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    readonly dataDir: string,
    readonly store?: TerminalStore | null,
    database?: DatabaseService,
  ) {
    this.dir = path.join(dataDir, 'terminal');
    this.repository = new WorkspaceRepository(database ?? new DatabaseService(dataDir));
    if (store) store.workspace = this;
  }
  get items() {
    return this.repository.list();
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    return this;
  }
  list(owner: string, scope: unknown) {
    if (scope !== 'assets' && scope !== 'commands') throw fail('目录类型无效');
    return this.repository.list(owner, scope);
  }
  validateFolder(
    owner: string,
    id: unknown,
    scope: 'assets' | 'commands' = 'assets',
    items?: WorkspaceItem[],
  ): string | null {
    if (id === null || id === undefined || id === '') return null;
    if (typeof id !== 'string') throw fail('所属目录不存在');
    const folder = items
      ? items.find((row) => row.id === id && row.ownerUid === owner)
      : this.repository.find(owner, id);
    if (!folder || folder.scope !== scope || folder.kind !== 'folder') throw fail('所属目录不存在');
    return id;
  }
  private transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.store) return this.store.transaction(work);
    const job = this.pending.then(work);
    this.pending = job.catch(() => {});
    return job;
  }
  save(owner: string, value: unknown, id?: string) {
    return this.transaction(() => {
      let input = inputRecord(value);
      const rows = this.repository.list(owner),
        old = id ? rows.find((row) => row.id === id) : undefined;
      if (id && !old) throw fail('条目不存在', 404);
      if (old) input = { ...old, ...input };
      const { kind, scope, name, content } = input;
      if (
        (scope !== 'assets' && scope !== 'commands') ||
        (kind !== 'folder' && kind !== 'command') ||
        (kind === 'command' && scope !== 'commands')
      )
        throw fail('条目类型无效');
      if (old && (old.kind !== kind || old.scope !== scope)) throw fail('不能修改条目类型');
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 80 ||
        /[\x00-\x1f\x7f]/.test(name)
      )
        throw fail('名称无效');
      if (
        kind === 'command' &&
        (typeof content !== 'string' ||
          !content.length ||
          Buffer.byteLength(content) > 16384 ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(content))
      )
        throw fail('指令最多 16 KiB，不支持控制字符');
      if (!old && rows.length >= CONFIG_LIMITS.workspace) throw fail('最多保存 1000 个目录和指令');
      const base = {
        id: old?.id ?? randomBytes(12).toString('hex'),
        ownerUid: owner,
        name: name.trim(),
        parentId: this.validateFolder(owner, input.parentId, scope, rows),
      };
      const item: WorkspaceItem =
        kind === 'command'
          ? { ...base, kind, scope: 'commands', content: String(content) }
          : { ...base, kind, scope };
      const next = rows.filter((row) => row.id !== item.id).concat(item);
      for (const row of next) {
        let cursor: WorkspaceItem | undefined = row,
          depth = 0;
        const seen = new Set<string>();
        while (cursor) {
          if (seen.has(cursor.id)) throw fail('目录不能循环嵌套');
          seen.add(cursor.id);
          if (cursor.kind === 'folder' && ++depth > CONFIG_LIMITS.folderDepth)
            throw fail('目录最多 16 层');
          const parentId: string | null = cursor.parentId;
          cursor = parentId ? next.find((entry) => entry.id === parentId) : undefined;
        }
      }
      this.repository.save(item);
      return item;
    });
  }
  remove(owner: string, id: string) {
    return this.transaction(() => {
      const item = this.repository.find(owner, id);
      if (!item) throw fail('条目不存在', 404);
      if (
        this.repository.list(owner).some((row) => row.parentId === id) ||
        this.repository.hasVncChildren(owner, id) ||
        this.store?.connections.some((row) => row.ownerUid === owner && row.folderId === id)
      )
        throw fail('请先移动目录内容', 409);
      this.repository.remove(owner, id);
    });
  }
}
