import { RetentionRepository } from './retention.repository.js';
import { randomUUID } from 'node:crypto';
import {
  operationActions,
  operationStatuses,
  type OperationAction,
  type OperationStatus,
  type OperationRetention,
  type OperationPage,
} from '../domain/operations.js';
import { DomainError } from '../errors.js';
import type { DatabaseService } from './database.service.js';
const safe = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 120);
export class OperationRepository {
  constructor(private readonly database: DatabaseService) {}
  settings(owner: string): { retention: OperationRetention } {
    return {
      retention: Number(
        this.database.connection
          .prepare('SELECT retention FROM operation_settings WHERE owner_uid=?')
          .get(owner)?.retention ?? new RetentionRepository(this.database).limits().operations,
      ) as OperationRetention,
    };
  }
  saveSettings(owner: string, retention: OperationRetention) {
    if (![100, 500, 1000, 5000].includes(retention)) throw new DomainError('保留数量无效');
    return this.database.transaction(() => {
      this.database.connection
        .prepare(
          'INSERT INTO operation_settings VALUES(?,?) ON CONFLICT(owner_uid) DO UPDATE SET retention=excluded.retention',
        )
        .run(owner, retention);
      this.trim(owner);
      return this.settings(owner);
    });
  }
  begin(owner: string, action: OperationAction, target: string) {
    const id = randomUUID();
    this.database.connection
      .prepare("INSERT INTO operation_records VALUES(?,?,?,?, 'running',?,NULL,'操作进行中')")
      .run(id, owner, action, safe(target), Date.now());
    return id;
  }
  finish(id: string, owner: string, status: Exclude<OperationStatus, 'running'>, summary: string) {
    this.database.transaction(() => {
      this.database.connection
        .prepare(
          "UPDATE operation_records SET status=?,finished_at=?,summary=? WHERE id=? AND owner_uid=? AND status='running'",
        )
        .run(status, Date.now(), safe(summary), id, owner);
      this.trim(owner);
    });
  }
  recover() {
    this.database.transaction(() => {
      this.database.connection
        .prepare(
          "UPDATE operation_records SET status='interrupted',finished_at=?,summary='服务中断，实际操作结果未知，请先核实' WHERE status='running'",
        )
        .run(Date.now());
      for (const row of this.database.connection
        .prepare('SELECT DISTINCT owner_uid FROM operation_records')
        .all())
        this.trim(String(row.owner_uid));
    });
  }
  private trim(owner: string) {
    this.database.connection
      .prepare(
        "DELETE FROM operation_records WHERE owner_uid=? AND status!='running' AND id IN (SELECT id FROM operation_records WHERE owner_uid=? AND status!='running' ORDER BY started_at DESC,id DESC LIMIT -1 OFFSET ?)",
      )
      .run(
        owner,
        owner,
        Math.min(
          this.settings(owner).retention,
          new RetentionRepository(this.database).limits().operations,
        ),
      );
  }
  list(owner: string, page = 1, pageSize = 10, action = 'all', status = 'all'): OperationPage {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize) ||
      (action !== 'all' && !operationActions.includes(action as OperationAction)) ||
      (status !== 'all' && !operationStatuses.includes(status as OperationStatus))
    )
      throw new DomainError('筛选或分页参数无效');
    const where = "owner_uid=? AND (?='all' OR action=?) AND (?='all' OR status=?)",
      args = [owner, action, action, status, status];
    return {
      items: this.database.connection
        .prepare(
          `SELECT * FROM operation_records WHERE ${where} ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, (page - 1) * pageSize)
        .map((r) => ({
          id: String(r.id),
          ownerUid: String(r.owner_uid),
          action: r.action as OperationAction,
          target: String(r.target),
          status: r.status as OperationStatus,
          startedAt: new Date(Number(r.started_at)).toISOString(),
          finishedAt: r.finished_at === null ? null : new Date(Number(r.finished_at)).toISOString(),
          summary: String(r.summary),
        })),
      total: Number(
        this.database.connection
          .prepare(`SELECT count(*) n FROM operation_records WHERE ${where}`)
          .get(...args)?.n,
      ),
      page,
      pageSize,
    };
  }
}
