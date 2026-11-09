import path from 'node:path';
import { DomainError } from '../errors.js';
import { NotificationRepository } from './notification.repository.js';
import type { SQLInputValue } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import type { ScanJob } from '../domain/storage.js';
import type { Page } from '../domain/tasks.js';
import type { DatabaseService } from './database.service.js';
import {
  bool,
  insert,
  integer,
  json,
  list,
  optionalText,
  record,
  rest,
  resultCollections,
  scanFields,
  text,
  time,
  type RecordValue,
} from './records.js';
import { iso, position, upsert } from './sql.js';

export interface ScanHistoryQuery {
  page: number;
  pageSize: number;
  mode?: 'space' | 'duplicates';
}
export interface ScanPageQuery {
  page: number;
  pageSize: number;
  sort: 'name' | 'size' | 'modifiedAt';
  direction: 'asc' | 'desc';
  collection?: 'catalog' | 'largestFiles' | 'topDirectories' | 'extensions';
  search?: string;
}
export class ScanRepository {
  private writing = new Set<string>();
  constructor(readonly database: DatabaseService) {}
  private values(item: RecordValue, order: number): Record<string, SQLInputValue> {
    const result = item.result == null ? null : record(item.result);
    return {
      id: text(item.id),
      owner_uid: text(item.owner),
      mode: text(item.mode),
      path: text(item.path),
      status: text(item.status),
      created_at: time(item.startedAt),
      finished_at: time(item.finishedAt),
      error: optionalText(item.error),
      limited: Number(item.status === 'limited'),
      statistics: json({
        job: rest(item, scanFields),
        result: result == null ? null : rest(result, resultCollections),
      }),
      position: order,
    };
  }
  private decodeEntry(row: RecordValue): RecordValue {
    const metadata = record(JSON.parse(text(row.details))),
      fields = list(metadata.fields).map(text),
      extra = record(metadata.values);
    const base: RecordValue = {
      name: row.name,
      path: row.path,
      type: row.type,
      size: row.size,
      mtime: row.modified_at,
      modifiedAt: row.modified_at,
    };
    return {
      ...extra,
      ...Object.fromEntries(fields.filter((key) => key in base).map((key) => [key, base[key]])),
    };
  }
  private decode(row: RecordValue, withResult = true): ScanJob {
    const meta = record(JSON.parse(text(row.statistics))),
      id = text(row.id),
      generation = integer(row.result_generation);
    const result = meta.result == null ? null : { ...record(meta.result) };
    if (result && withResult) {
      for (const [field, collection] of [
        ['catalog', 'catalog'],
        ['largestFiles', 'largestFiles'],
        ['entries', 'topDirectories'],
        ['extensions', 'extensions'],
      ] as const)
        result[field] = this.database.connection
          .prepare(
            'SELECT * FROM scan_entries WHERE scan_id=? AND generation=? AND collection=? ORDER BY position',
          )
          .all(id, generation, collection)
          .map((item) => this.decodeEntry(item));
      result.groups = this.database.connection
        .prepare(
          'SELECT * FROM duplicate_groups WHERE scan_id=? AND generation=? ORDER BY position',
        )
        .all(id, generation)
        .map((group) => ({
          size: integer(group.size),
          count: integer(group.total_count),
          pathsTruncated: group.paths_truncated === 1,
          paths: this.database.connection
            .prepare('SELECT path FROM duplicate_members WHERE group_id=? ORDER BY position')
            .all(integer(group.id))
            .map((member) => text(member.path)),
        }));
    }
    return {
      ...record(meta.job),
      id,
      owner: text(row.owner_uid),
      mode: text(row.mode),
      path: text(row.path),
      status: text(row.status),
      ...(row.created_at == null ? {} : { startedAt: iso(row.created_at) }),
      ...(row.finished_at == null ? {} : { finishedAt: iso(row.finished_at) }),
      error: row.error == null ? null : text(row.error),
      ...(withResult ? { result } : {}),
    } as ScanJob;
  }
  list(owner?: string): ScanJob[] {
    const db = this.database.connection;
    return (
      owner === undefined
        ? db.prepare('SELECT * FROM scans ORDER BY position,id').all()
        : db.prepare('SELECT * FROM scans WHERE owner_uid=? ORDER BY position,id').all(owner)
    ).map((row) => this.decode(row, false));
  }
  historyPage(owner: string, query: ScanHistoryQuery): Page<ScanJob> {
    const { page, pageSize, mode } = query;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 200 ||
      (mode !== undefined && mode !== 'space' && mode !== 'duplicates')
    )
      throw new Error('历史记录分页参数无效');
    const db = this.database.connection;
    const where = ' WHERE owner_uid=?' + (mode ? ' AND mode=?' : '');
    const params: SQLInputValue[] = [owner, ...(mode ? [mode] : [])];
    return {
      page,
      pageSize,
      total: integer(db.prepare('SELECT COUNT(*) n FROM scans' + where).get(...params)?.n),
      items: db
        .prepare(
          'SELECT * FROM scans' + where + ' ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?',
        )
        .all(...params, pageSize, (page - 1) * pageSize)
        .map((row) => this.decode(row, false)),
    };
  }
  find(owner: string, id: string): ScanJob | undefined {
    const row = this.database.connection
      .prepare('SELECT * FROM scans WHERE owner_uid=? AND id=?')
      .get(owner, id);
    return row ? this.decode(row) : undefined;
  }
  async save(item: RecordValue): Promise<void> {
    const id = text(item.id),
      owner = text(item.owner),
      db = this.database.connection;
    if (this.writing.has(id)) throw new Error('扫描记录正在保存');
    this.writing.add(id);
    let generation: number | undefined,
      created = false;
    try {
      const old = db.prepare('SELECT * FROM scans WHERE id=?').get(id);
      if (old && old.owner_uid !== owner) throw new Error('扫描所属用户不能修改');
      const notify = () => {
        if (!old || ['running', 'queued'].includes(String(old.status)))
          new NotificationRepository(this.database).scanResult(item);
      };
      const order = position(db, 'scans', id),
        values = this.values(item, order);
      if (item.result === undefined && old) {
        const previous = record(JSON.parse(text(old.statistics))),
          next = record(JSON.parse(text(values.statistics)));
        values.statistics = json({ ...next, result: previous.result });
        this.database.transaction(() => {
          upsert(db, 'scans', values);
          notify();
        });
        return;
      }
      if (item.result == null) {
        this.database.transaction(() => {
          upsert(db, 'scans', values);
          notify();
          db.prepare('DELETE FROM scan_entries WHERE scan_id=?').run(id);
          db.prepare('DELETE FROM duplicate_groups WHERE scan_id=?').run(id);
        });
        return;
      }
      generation = integer(old?.result_generation ?? 0) + 1;
      if (!old) {
        insert(db, 'scans', this.values({ ...item, status: 'running', result: null }, order));
        created = true;
      }
      const result = record(item.result),
        pending: (() => void)[] = [];
      for (const [field, collection] of [
        ['catalog', 'catalog'],
        ['largestFiles', 'largestFiles'],
        ['entries', 'topDirectories'],
        ['extensions', 'extensions'],
      ] as const)
        list(result[field] ?? []).forEach((value, index) => {
          const entry = record(value);
          pending.push(() =>
            insert(db, 'scan_entries', {
              scan_id: id,
              generation: generation!,
              collection,
              position: index,
              name: optionalText(entry.name ?? entry.extension),
              path: optionalText(entry.path),
              type: optionalText(entry.type),
              size: integer(entry.size ?? entry.bytes ?? 0),
              modified_at:
                typeof (entry.modifiedAt ?? entry.mtime) === 'number'
                  ? ((entry.modifiedAt ?? entry.mtime) as number)
                  : null,
              details: json({
                fields: Object.keys(entry),
                values: rest(entry, ['name', 'path', 'type', 'size', 'mtime', 'modifiedAt']),
              }),
            }),
          );
        });
      list(result.groups ?? []).forEach((value, index) => {
        const group = record(value),
          paths = list(group.paths);
        pending.push(() => {
          insert(db, 'duplicate_groups', {
            scan_id: id,
            generation: generation!,
            position: index,
            size: integer(group.size),
            total_count: integer(group.count ?? paths.length),
            paths_truncated: bool(group.pathsTruncated),
          });
          const groupId = integer(db.prepare('SELECT last_insert_rowid() id').get()?.id);
          paths.forEach((entry, i) =>
            insert(db, 'duplicate_members', { group_id: groupId, position: i, path: text(entry) }),
          );
        });
      });
      for (let offset = 0; offset < pending.length; offset += 400) {
        this.database.transaction(() =>
          pending.slice(offset, offset + 400).forEach((write) => write()),
        );
        await setImmediate();
      }
      this.database.transaction(() => {
        upsert(db, 'scans', { ...values, result_generation: generation! });
        notify();
        db.prepare('DELETE FROM scan_entries WHERE scan_id=? AND generation<>?').run(
          id,
          generation!,
        );
        db.prepare('DELETE FROM duplicate_groups WHERE scan_id=? AND generation<>?').run(
          id,
          generation!,
        );
      });
    } catch (error) {
      this.database.transaction(() => {
        if (created) db.prepare('DELETE FROM scans WHERE id=?').run(id);
        else if (generation !== undefined) {
          db.prepare('DELETE FROM scan_entries WHERE scan_id=? AND generation=?').run(
            id,
            generation,
          );
          db.prepare('DELETE FROM duplicate_groups WHERE scan_id=? AND generation=?').run(
            id,
            generation,
          );
        }
      });
      throw error;
    } finally {
      this.writing.delete(id);
    }
  }
  entries(owner: string, id: string, query: ScanPageQuery): Page<RecordValue> {
    const { page, pageSize, sort, direction } = query,
      collection = query.collection ?? 'catalog';
    const columns = { name: 'name', size: 'size', modifiedAt: 'modified_at' };
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 200 ||
      !Object.hasOwn(columns, sort) ||
      !['asc', 'desc'].includes(direction) ||
      !['catalog', 'largestFiles', 'topDirectories', 'extensions'].includes(collection)
    )
      throw new Error('分页或排序参数无效');
    const scan = this.database.connection
      .prepare('SELECT result_generation FROM scans WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!scan) throw Object.assign(new Error('扫描记录不存在'), { status: 404 });
    const where =
      ' WHERE scan_id=? AND generation=? AND collection=?' +
      (query.search ? " AND instr(lower(COALESCE(name,path,'')),lower(?))>0" : '');
    const params: SQLInputValue[] = [
      id,
      integer(scan.result_generation),
      collection,
      ...(query.search ? [query.search] : []),
    ];
    const db = this.database.connection;
    return {
      page,
      pageSize,
      total: integer(db.prepare('SELECT COUNT(*) n FROM scan_entries' + where).get(...params)?.n),
      items: db
        .prepare(
          `SELECT * FROM scan_entries${where} ORDER BY ${columns[sort]} ${direction},id ASC LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, (page - 1) * pageSize)
        .map((row) => this.decodeEntry(row)),
    };
  }
  compare(
    owner: string,
    beforeId: string,
    afterId: string,
    query: { page: number; pageSize: number; kind?: string },
  ) {
    const { page, pageSize, kind = 'all' } = query;
    const kinds = ['added', 'deleted', 'size', 'directory', 'unconfirmed'];
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 200 ||
      (kind !== 'all' && !kinds.includes(kind))
    )
      throw new DomainError('对比分页参数无效', 400);
    const db = this.database.connection;
    const load = (id: string) => {
      const row = db.prepare('SELECT * FROM scans WHERE owner_uid=? AND id=?').get(owner, id);
      if (!row) throw new DomainError('扫描记录不存在', 404);
      const meta = record(JSON.parse(text(row.statistics)));
      if (row.status !== 'completed' || row.mode !== 'space' || meta.result == null)
        throw new DomainError('请选择两次已完成的空间扫描', 400);
      const result = record(meta.result);
      const traversalComplete =
        result.errors === 0 &&
        result.skippedLinks === 0 &&
        result.skippedMounts === 0 &&
        result.skippedHardLinks === 0;
      return {
        row,
        result,
        traversalComplete,
        catalogComplete: traversalComplete && result.catalogTruncated === false,
      };
    };
    const before = load(beforeId),
      after = load(afterId);
    if (
      beforeId === afterId ||
      path.resolve(text(before.row.path)) !== path.resolve(text(after.row.path))
    )
      throw new DomainError('请选择同一路径的两次不同扫描', 400);
    if (Number(before.row.created_at) > Number(after.row.created_at))
      throw new DomainError('基准扫描时间不能晚于对比扫描', 400);
    // Use stored generations and SQL pagination; never load the full catalog into the API process.
    const cte = `WITH b AS (SELECT * FROM scan_entries WHERE scan_id=? AND generation=? AND collection='catalog'),
      a AS (SELECT * FROM scan_entries WHERE scan_id=? AND generation=? AND collection='catalog'),
      bd AS (SELECT * FROM scan_entries WHERE scan_id=? AND generation=? AND collection='topDirectories' AND type='directory'),
      ad AS (SELECT * FROM scan_entries WHERE scan_id=? AND generation=? AND collection='topDirectories' AND type='directory'),
      changes AS (
        SELECT a.path, CASE WHEN b.path IS NULL THEN ? ELSE 'size' END kind, b.size beforeSize, a.size afterSize,
          a.size-COALESCE(b.size,0) delta FROM a LEFT JOIN b ON a.path=b.path WHERE b.path IS NULL OR a.size<>b.size
        UNION ALL SELECT b.path, ?, b.size, NULL, -b.size FROM b LEFT JOIN a ON b.path=a.path WHERE a.path IS NULL
        UNION ALL SELECT ad.path, 'directory', bd.size, ad.size, ad.size-bd.size FROM ad JOIN bd ON ad.path=bd.path WHERE ad.size<>bd.size
      )`;
    const params: SQLInputValue[] = [
      beforeId,
      integer(before.row.result_generation),
      afterId,
      integer(after.row.result_generation),
      beforeId,
      integer(before.row.result_generation),
      afterId,
      integer(after.row.result_generation),
      before.catalogComplete ? 'added' : 'unconfirmed',
      after.catalogComplete ? 'deleted' : 'unconfirmed',
    ];
    const counts = Object.fromEntries(
      db
        .prepare(cte + ' SELECT kind, COUNT(*) n FROM changes GROUP BY kind')
        .all(...params)
        .map((row) => [text(row.kind), integer(row.n)]),
    );
    const filter = kind === 'all' ? '' : ' WHERE kind=?';
    const filtered = [...params, ...(kind === 'all' ? [] : [kind])];
    const directoryComplete =
      before.traversalComplete &&
      after.traversalComplete &&
      before.result.truncated === false &&
      after.result.truncated === false;
    return {
      before: { id: beforeId, path: text(before.row.path), complete: before.catalogComplete },
      after: { id: afterId, path: text(after.row.path), complete: after.catalogComplete },
      directoryComplete,
      counts,
      page,
      pageSize,
      total:
        kind === 'all' ? Object.values(counts).reduce((sum, n) => sum + n, 0) : (counts[kind] ?? 0),
      items: db
        .prepare(
          cte +
            ' SELECT * FROM changes' +
            filter +
            ' ORDER BY abs(delta) DESC,path ASC LIMIT ? OFFSET ?',
        )
        .all(...filtered, pageSize, (page - 1) * pageSize)
        .map((row) => ({
          path: text(row.path),
          kind: text(row.kind),
          beforeSize: row.beforeSize == null ? null : integer(row.beforeSize),
          afterSize: row.afterSize == null ? null : integer(row.afterSize),
          delta: row.kind === 'unconfirmed' ? null : integer(row.delta),
          uncertain: row.kind === 'unconfirmed' || (row.kind === 'directory' && !directoryComplete),
        })),
      warning:
        '仅对比已保存的普通文件目录；硬链接去重、符号链接、挂载点、错误和截断均可能造成覆盖不完整。未确认条目仅表示某次结果未收录，不能认定新增或删除。目录变化仅展示两次均收录的一级目录。',
    };
  }
  remove(owner: string, ids: string[]): void {
    this.database.transaction(() => {
      for (const id of ids) {
        if (this.writing.has(id)) throw new Error('扫描记录正在保存');
        this.database.connection
          .prepare('DELETE FROM scans WHERE owner_uid=? AND id=?')
          .run(owner, id);
      }
    });
  }
}
