import type { DatabaseService } from './database.service.js';
import {
  defaultHistoryLimits,
  type HistoryLimits,
  type HistoryKind,
} from '../domain/maintenance.js';
import { DomainError } from '../errors.js';
const definitions: Record<
  HistoryKind,
  { table: string; owner: string; time: string; eligible: string; scope?: string }
> = {
  scans: { table: 'scans', owner: 'owner_uid', time: 'created_at', eligible: "status!='running'" },
  renames: {
    table: 'rename_batches',
    owner: 'owner_uid',
    time: 'created_at',
    eligible: "status!='running'",
  },
  taskRuns: { table: 'task_runs', owner: "''", time: 'started_at', eligible: "status!='running'" },
  operations: {
    table: 'operation_records',
    owner: 'owner_uid',
    time: 'started_at',
    eligible: "status!='running'",
  },
  appMessages: {
    table: 'notification_deliveries',
    owner: 'owner_uid',
    time: 'created_at',
    scope: "channel='inapp'",
    eligible: "status IN ('success','failed','cancelled')",
  },
  completedReminders: {
    table: 'reminders',
    owner: 'owner_uid',
    time: 'completed_at',
    scope: "status='completed'",
    eligible: "repeat='none'",
  },
  deliveries: {
    scope: "channel!='inapp'",
    table: 'notification_deliveries',
    owner: 'owner_uid',
    time: 'created_at',
    eligible: "status IN ('success','failed','cancelled')",
  },
  restoreReceipts: {
    table: 'backup_receipts',
    owner: 'owner_uid',
    time: 'created_at',
    eligible: 'created_at < ?',
  },
};
/** Identifiers are private constants, never supplied by API callers. All values are bound. */
export class RetentionRepository {
  constructor(readonly database: DatabaseService) {}
  limits(): HistoryLimits {
    const r = this.database.connection.prepare('SELECT * FROM history_limits WHERE id=1').get();
    return r
      ? {
          scans: Number(r.scans),
          renames: Number(r.renames),
          taskRuns: Number(r.task_runs),
          operations: Number(r.operations),
          deliveries: Number(r.deliveries),
          appMessages: Number(r.app_messages),
          completedReminders: Number(r.completed_reminders),
          restoreReceipts: Number(r.restore_receipts),
          serviceLogMiB: Number(r.service_log_mib),
        }
      : { ...defaultHistoryLimits };
  }
  save(input: HistoryLimits) {
    for (const key of Object.keys(defaultHistoryLimits) as (keyof HistoryLimits)[])
      if (
        !Number.isInteger(input[key]) ||
        input[key] < 1 ||
        input[key] > (key === 'serviceLogMiB' ? 100 : 10000)
      )
        throw new DomainError('保留上限无效');
    this.database.connection
      .prepare(
        'INSERT INTO history_limits(id,scans,renames,task_runs,operations,deliveries,restore_receipts,service_log_mib,app_messages,completed_reminders) VALUES(1,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scans=excluded.scans,renames=excluded.renames,task_runs=excluded.task_runs,operations=excluded.operations,deliveries=excluded.deliveries,restore_receipts=excluded.restore_receipts,service_log_mib=excluded.service_log_mib,app_messages=excluded.app_messages,completed_reminders=excluded.completed_reminders',
      )
      .run(
        input.scans,
        input.renames,
        input.taskRuns,
        input.operations,
        input.deliveries,
        input.restoreReceipts,
        input.serviceLogMiB,
        input.appMessages,
        input.completedReminders,
      );
    return this.limits();
  }
  private filter(kind: HistoryKind, owner?: string, protectedIds: string[] = []) {
    const d = definitions[kind],
      args: (string | number)[] = [],
      clauses: string[] = [];
    if (kind === 'restoreReceipts') args.push(Date.now() - 7 * 86400000);
    clauses.push(d.eligible);
    if (d.scope) clauses.push(d.scope);
    // Legacy tasks with no owner are shared administrator tasks, as in the task history API.
    if (owner !== undefined) {
      if (kind === 'taskRuns') {
        clauses.push('(task_id IN(SELECT id FROM tasks WHERE owner_uid=? OR owner_uid IS NULL))');
        args.push(owner);
      } else {
        clauses.push(d.owner + '=?');
        args.push(owner);
      }
    }
    if (protectedIds.length) {
      clauses.push('id NOT IN(SELECT value FROM json_each(?))');
      args.push(JSON.stringify(protectedIds));
    }
    return { where: clauses.join(' AND '), args };
  }
  count(kind: HistoryKind, owner: string, protectedIds: string[] = []) {
    const d = definitions[kind],
      f = this.filter(kind, owner, protectedIds),
      c = this.database.connection;
    const eligible = Number(
      c.prepare(`SELECT count(*) n FROM ${d.table} WHERE ${f.where}`).get(...f.args)?.n,
    );
    const scope =
      kind === 'taskRuns'
        ? 'task_id IN(SELECT id FROM tasks WHERE owner_uid=? OR owner_uid IS NULL)'
        : d.owner + '=?';
    const totalScope = scope + (d.scope ? ' AND ' + d.scope : '');
    const total = Number(
      c.prepare(`SELECT count(*) n FROM ${d.table} WHERE ${totalScope}`).get(owner)?.n,
    );
    return { count: total, protected: total - eligible };
  }
  trim(kind: HistoryKind, limit: number, protectedIds: string[] = [], owner?: string): string[] {
    const d = definitions[kind],
      f = this.filter(kind, owner, protectedIds);
    // Rank all terminal receipts so protected recent receipts still consume quota.
    const ranking = kind === 'restoreReceipts' ? '1=1' : f.where;
    const rankArgs = kind === 'restoreReceipts' ? [] : f.args;
    const extra = kind === 'restoreReceipts' ? ' AND ' + d.eligible : '';
    return this.remove(
      kind,
      `rowid IN(SELECT rid FROM (SELECT rowid rid,ROW_NUMBER() OVER(PARTITION BY ${d.owner} ORDER BY ${d.time} DESC,rowid DESC) n FROM ${d.table} WHERE ${ranking}) WHERE n>?)${extra}`,
      [...rankArgs, limit, ...(kind === 'restoreReceipts' ? f.args : [])],
    );
  }
  clear(kind: HistoryKind, owner: string, protectedIds: string[] = []) {
    const f = this.filter(kind, owner, protectedIds);
    return this.remove(kind, f.where, f.args);
  }
  removeSelected(kind: HistoryKind, owner: string, ids: string[]) {
    const d = definitions[kind],
      f = this.filter(kind, owner),
      id = kind === 'restoreReceipts' ? 'request_id' : 'id';
    return this.database.transaction(() => {
      const rows = this.database.connection
        .prepare(
          `SELECT ${id} FROM ${d.table} WHERE ${f.where} AND ${id} IN(SELECT value FROM json_each(?))`,
        )
        .all(...f.args, JSON.stringify(ids));
      if (rows.length !== ids.length)
        throw new DomainError('部分记录不存在、正在处理或处于保护期，请刷新后重试', 409);
      return this.remove(kind, `${f.where} AND ${id} IN(SELECT value FROM json_each(?))`, [
        ...f.args,
        JSON.stringify(ids),
      ]).length;
    });
  }
  private remove(kind: HistoryKind, where: string, args: (string | number)[]): string[] {
    const d = definitions[kind];
    const id = kind === 'restoreReceipts' ? 'request_id' : 'id';
    return this.database.connection
      .prepare(`DELETE FROM ${d.table} WHERE ${where} RETURNING ${id}`)
      .all(...args)
      .map((row) => String(row[id]));
  }
}
