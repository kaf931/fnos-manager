import type { Page, PageOptions } from '../domain/tasks.js';
import type { RenameRecord, RenameSummary } from '../domain/storage.js';
import type { DatabaseService } from './database.service.js';
import {
  insertRename,
  record,
  integer,
  text,
  json,
  rest,
  time,
  optionalText,
  type RecordValue,
} from './records.js';
import { iso, position } from './sql.js';
export class RenameRepository {
  constructor(private readonly database: DatabaseService) {}
  private decode(row: RecordValue, details: false): RenameSummary;
  private decode(row: RecordValue, details?: true): RenameRecord;
  private decode(row: RecordValue, details = true): RenameSummary | RenameRecord {
    const base = {
      ...record(JSON.parse(text(row.details))),
      id: text(row.id),
      owner: text(row.owner_uid),
      path: text(row.path),
      operation: text(row.operation),
      status: text(row.status),
      ...(row.created_at == null ? {} : { startedAt: iso(row.created_at) }),
      ...(row.finished_at == null ? {} : { finishedAt: iso(row.finished_at) }),
      ...(row.undo_of == null ? {} : { undoOf: text(row.undo_of) }),
      ...(row.undone_by == null ? {} : { undoneBy: text(row.undone_by) }),
    } as RenameSummary;
    if (!details) return base;
    return {
      ...base,
      entries: this.database.connection
        .prepare('SELECT * FROM rename_items WHERE batch_id=? ORDER BY position')
        .all(text(row.id))
        .map((item) => ({
          ...record(JSON.parse(text(item.details))),
          ...(item.old_name == null ? {} : { from: text(item.old_name) }),
          ...(item.new_name == null ? {} : { to: text(item.new_name) }),
          ...(item.status == null ? {} : { status: text(item.status) }),
        })),
    } as RenameRecord;
  }
  find(owner: string, id: string): RenameRecord | undefined {
    const row = this.database.connection
      .prepare('SELECT * FROM rename_batches WHERE owner_uid=? AND id=?')
      .get(owner, id);
    return row ? this.decode(row) : undefined;
  }
  list(owner?: string): RenameSummary[] {
    const db = this.database.connection;
    return (
      owner === undefined
        ? db.prepare('SELECT * FROM rename_batches ORDER BY position,id').all()
        : db
            .prepare('SELECT * FROM rename_batches WHERE owner_uid=? ORDER BY position,id')
            .all(owner)
    ).map((row) => this.decode(row, false));
  }
  historyPage(owner: string, query: PageOptions): Page<RenameSummary> {
    const { page, pageSize } = query;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 200
    )
      throw new Error('历史记录分页参数无效');
    const db = this.database.connection;
    return {
      page,
      pageSize,
      total: integer(
        db.prepare('SELECT COUNT(*) n FROM rename_batches WHERE owner_uid=?').get(owner)?.n,
      ),
      items: db
        .prepare(
          'SELECT * FROM rename_batches WHERE owner_uid=? ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?',
        )
        .all(owner, pageSize, (page - 1) * pageSize)
        .map((row) => this.decode(row, false)),
    };
  }
  save(item: RecordValue): void {
    const id = text(item.id),
      owner = text(item.owner),
      db = this.database.connection;
    this.database.transaction(() => {
      const previous = db.prepare('SELECT owner_uid FROM rename_batches WHERE id=?').get(id);
      if (previous && previous.owner_uid !== owner) throw new Error('记录所属用户不能修改');
      if (previous && item.entries === undefined) {
        db.prepare(
          'UPDATE rename_batches SET path=?,operation=?,status=?,created_at=?,finished_at=?,undo_of=?,undone_by=?,details=? WHERE id=? AND owner_uid=?',
        ).run(
          text(item.path),
          text(item.operation),
          text(item.status),
          time(item.startedAt),
          time(item.finishedAt),
          optionalText(item.undoOf),
          optionalText(item.undoneBy),
          json(
            rest(item, [
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
          id,
          owner,
        );
        return;
      }
      const order = position(db, 'rename_batches', id);
      db.prepare('DELETE FROM rename_batches WHERE id=?').run(id);
      insertRename(db, item, order);
    });
  }
  remove(owner: string, ids: string[]): void {
    this.database.transaction(() =>
      ids.forEach((id) =>
        this.database.connection
          .prepare('DELETE FROM rename_batches WHERE owner_uid=? AND id=?')
          .run(owner, id),
      ),
    );
  }
}
