import { RetentionRepository } from './retention.repository.js';
import { NotificationRepository } from './notification.repository.js';
import type {
  Page,
  PageOptions,
  Schedule,
  TaskRecord,
  TaskRun,
  TaskType,
} from '../domain/tasks.js';
import type { PowerTarget } from '../domain/wake.js';
import type { DatabaseService } from './database.service.js';
import {
  bool,
  insert,
  integer,
  json,
  record,
  rest,
  runValues,
  taskFields,
  text,
  time,
  type RecordValue,
} from './records.js';
import { iso, position, upsert } from './sql.js';

export class TaskRepository {
  constructor(private readonly database: DatabaseService) {}
  transaction<T>(work: () => T): T {
    return this.database.transaction(work);
  }
  private decode(row: RecordValue): TaskRecord {
    const related = this.database.connection
      .prepare(
        'SELECT selected_device_id,target_snapshot FROM task_devices WHERE task_id=? ORDER BY position,selected_device_id',
      )
      .all(text(row.id));
    const targets = related.map((r) => record(JSON.parse(text(r.target_snapshot))));
    return {
      ...record(JSON.parse(text(row.options))),
      id: text(row.id),
      name: text(row.name),
      type: text(row.type) as TaskType,
      ...(row.owner_uid == null ? {} : { ownerUid: text(row.owner_uid) }),
      enabled: row.enabled === 1,
      ...(row.pending_reason == null ? {} : { pendingReason: text(row.pending_reason) }),
      schedule: JSON.parse(text(row.schedule)) as Schedule,
      timeoutSeconds: integer(row.timeout),
      nextRunAt: iso(row.next_run_at) ?? null,
      ...(row.created_at == null ? {} : { createdAt: iso(row.created_at) }),
      ...(row.updated_at == null ? {} : { updatedAt: iso(row.updated_at) }),
      ...(related.length ? { deviceIds: related.map((r) => text(r.selected_device_id)) } : {}),
      ...(targets.some((target) => Object.keys(target).length)
        ? {
            deviceTargets: targets.map((target) => ({
              id: text(target.id),
              connectionId: text(target.connectionId),
              host: text(target.host),
              port: integer(target.port),
              username: text(target.username),
              system: text(target.system) as PowerTarget['system'],
            })),
          }
        : {}),
    };
  }
  list(): TaskRecord[] {
    return this.database.connection
      .prepare('SELECT * FROM tasks ORDER BY position,id')
      .all()
      .map((row) => this.decode(row));
  }
  find(id: string): TaskRecord | undefined {
    const row = this.database.connection.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    return row ? this.decode(row) : undefined;
  }
  save(item: TaskRecord): void {
    this.transaction(() => {
      const db = this.database.connection;
      const previous = db.prepare('SELECT owner_uid FROM tasks WHERE id=?').get(item.id);
      if (previous && previous.owner_uid !== (item.ownerUid ?? null))
        throw new Error('任务所属用户不能修改');
      upsert(db, 'tasks', {
        id: item.id,
        owner_uid: item.ownerUid ?? null,
        name: item.name,
        type: item.type,
        enabled: bool(item.enabled),
        pending_reason: item.pendingReason ?? null,
        schedule: json(item.schedule),
        options: json(rest(item, taskFields)),
        timeout: integer(item.timeoutSeconds),
        next_run_at: time(item.nextRunAt),
        position: position(db, 'tasks', item.id),
        created_at: time(item.createdAt),
        updated_at: time(item.updatedAt),
      });
      const previousTargets = db
        .prepare('SELECT selected_device_id FROM task_devices WHERE task_id=?')
        .all(item.id);
      db.prepare('DELETE FROM task_devices WHERE task_id=?').run(item.id);
      item.deviceIds?.forEach((id, index) => {
        const exists = db
          .prepare('SELECT 1 FROM wake_devices WHERE owner_uid=? AND id=?')
          .get(text(item.ownerUid), id);
        if (!exists && !previousTargets.some((row) => row.selected_device_id === id))
          throw new Error('关联设备不存在');
        insert(db, 'task_devices', {
          task_id: item.id,
          owner_uid: text(item.ownerUid),
          device_id: exists ? id : null,
          selected_device_id: id,
          position: index,
          target_snapshot: json(item.deviceTargets?.find((target) => target.id === id) ?? {}),
        });
      });
    });
  }
  remove(id: string): void {
    this.database.connection.prepare('DELETE FROM tasks WHERE id=?').run(id);
  }
  private decodeRun(row: RecordValue): TaskRun {
    return {
      id: text(row.id),
      taskId: text(row.task_id),
      taskName: text(row.task_name),
      trigger: text(row.trigger) as TaskRun['trigger'],
      status: text(row.status) as TaskRun['status'],
      startedAt: iso(row.started_at)!,
      stdout: text(row.stdout),
      stderr: text(row.stderr),
      ...(row.finished_at == null ? {} : { finishedAt: iso(row.finished_at) }),
      ...(row.exit_code == null ? {} : { code: integer(row.exit_code) }),
      truncated: row.truncated === 1,
      ...(row.device_results == null
        ? {}
        : { deviceResults: JSON.parse(text(row.device_results)) as unknown[] }),
    };
  }
  saveRun(run: TaskRun): void {
    this.transaction(() => {
      const previous = this.database.connection
        .prepare('SELECT status FROM task_runs WHERE id=?')
        .get(run.id);
      upsert(
        this.database.connection,
        'task_runs',
        runValues(run, position(this.database.connection, 'task_runs', run.id)),
      );
      if (run.status !== 'running' && (!previous || previous.status === 'running')) {
        const task = this.find(run.taskId);
        if (task) new NotificationRepository(this.database).taskResult(task, run);
      }
    });
  }

  history(taskId?: string, options: PageOptions = { page: 1, pageSize: 100 }): Page<TaskRun> {
    const { page, pageSize } = options;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new Error('分页参数无效');
    const where = taskId ? ' WHERE task_id=?' : '',
      params = taskId ? [taskId] : [];
    const db = this.database.connection;
    return {
      page,
      pageSize,
      total: integer(db.prepare('SELECT COUNT(*) n FROM task_runs' + where).get(...params)?.n),
      items: db
        .prepare(
          'SELECT * FROM task_runs' + where + ' ORDER BY started_at DESC,id LIMIT ? OFFSET ?',
        )
        .all(...params, pageSize, (page - 1) * pageSize)
        .map((row) => this.decodeRun(row)),
    };
  }
  running(): TaskRun[] {
    return this.database.connection
      .prepare("SELECT * FROM task_runs WHERE status='running' ORDER BY started_at,id")
      .all()
      .map((row) => this.decodeRun(row));
  }
  trimHistory(limit = new RetentionRepository(this.database).limits().taskRuns): void {
    this.database.connection
      .prepare(
        "DELETE FROM task_runs WHERE id IN (SELECT id FROM task_runs WHERE status!='running' ORDER BY started_at DESC,id LIMIT -1 OFFSET ?)",
      )
      .run(limit);
  }
}
