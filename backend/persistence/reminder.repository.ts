import { randomUUID } from 'node:crypto';
import { DomainError } from '../errors.js';
import { REMINDER_REPEATS, type Reminder, type ReminderInput } from '../domain/reminders.js';
import { notificationReady } from '../domain/notifications.js';
import { nextReminderAt } from '../notifications/reminder-schedule.js';
import type { DatabaseService } from './database.service.js';
import type { NotificationRepository } from './notification.repository.js';
import type { RecordValue } from './records.js';
const iso = (v: unknown) => (v == null ? null : new Date(Number(v)).toISOString());
export class ReminderRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationRepository,
  ) {}
  private decode(row: RecordValue): Reminder {
    return {
      id: String(row.id),
      name: String(row.name),
      content: String(row.content),
      dueAt: iso(row.due_at),
      repeat: row.repeat as Reminder['repeat'],
      templateIds: JSON.parse(String(row.template_ids)),
      enabled: row.enabled === 1,
      status: row.status as Reminder['status'],
      nextAt: iso(row.next_at),
      lastFiredAt: iso(row.last_fired_at),
      completedAt: iso(row.completed_at),
      error: row.error == null ? null : String(row.error),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    };
  }
  list(owner: string): Reminder[] {
    return this.database.connection
      .prepare(
        'SELECT * FROM reminders WHERE owner_uid=? ORDER BY status,next_at IS NULL,next_at,created_at DESC,id',
      )
      .all(owner)
      .map((r) => this.decode(r));
  }
  get(owner: string, id: string): Reminder {
    const row = this.database.connection
      .prepare('SELECT * FROM reminders WHERE owner_uid=? AND id=?')
      .get(owner, id);
    if (!row) throw new DomainError('提醒事项不存在', 404);
    return this.decode(row);
  }
  private templates(owner: string, ids: string[]) {
    let active = 0;
    for (const id of ids) {
      const value = this.notifications.getTemplate(owner, id);
      if (value.enabled && notificationReady(value)) active++;
    }
    if (!active) throw new DomainError('请至少选择一个已启用的通知模板');
  }
  private validate(
    owner: string,
    input: ReminderInput,
    now: number,
    preserveSchedule = false,
  ): ReminderInput {
    if (
      !input ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.trim().length > 80 ||
      /[\x00-\x1f\x7f]/.test(input.name) ||
      typeof input.content !== 'string' ||
      input.content.length > 8000 ||
      input.content.includes('\0') ||
      typeof input.enabled !== 'boolean' ||
      !REMINDER_REPEATS.includes(input.repeat) ||
      !Array.isArray(input.templateIds) ||
      input.templateIds.length > 50 ||
      input.templateIds.some((id) => typeof id !== 'string' || !id || id.length > 80) ||
      new Set(input.templateIds).size !== input.templateIds.length
    )
      throw new DomainError('提醒事项格式无效');
    const canonical =
      typeof input.dueAt === 'string'
        ? input.dueAt.includes('.')
          ? input.dueAt
          : input.dueAt.replace('Z', '.000Z')
        : '';
    const due =
      input.dueAt === null
        ? null
        : typeof input.dueAt === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.dueAt)
          ? Date.parse(input.dueAt)
          : NaN;
    if (due !== null && (!Number.isFinite(due) || new Date(due).toISOString() !== canonical))
      throw new DomainError('提醒时间无效');
    if (due === null) throw new DomainError('请先设置提醒时间');
    if (!preserveSchedule && input.enabled && input.repeat === 'none' && due !== null && due <= now)
      throw new DomainError('请选择未来的提醒时间');
    this.templates(owner, input.templateIds);
    return {
      ...input,
      name: input.name.trim(),
      dueAt: due === null ? null : new Date(due).toISOString(),
      templateIds: [...input.templateIds],
    };
  }
  create(owner: string, input: ReminderInput, now = Date.now()): Reminder {
    return this.database.transaction(() => {
      if (this.list(owner).length >= 500) throw new DomainError('最多保存 500 个提醒事项');
      const v = this.validate(owner, input, now),
        id = randomUUID();
      const next = v.enabled && v.dueAt ? nextReminderAt(v.dueAt, v.repeat, now) : null;
      this.database.connection
        .prepare(
          "INSERT INTO reminders(id,owner_uid,name,content,due_at,repeat,template_ids,enabled,status,next_at,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'open',?,1,?,?)",
        )
        .run(
          id,
          owner,
          v.name,
          v.content,
          v.dueAt ? Date.parse(v.dueAt) : null,
          v.repeat,
          JSON.stringify(v.templateIds),
          Number(v.enabled),
          next ? Date.parse(next) : null,
          now,
          now,
        );
      return this.get(owner, id);
    });
  }
  update(owner: string, id: string, input: ReminderInput, now = Date.now()): Reminder {
    return this.database.transaction(() => {
      const old = this.get(owner, id);
      const preserveSchedule =
        old.enabled &&
        input?.enabled &&
        old.nextAt !== null &&
        old.repeat === input.repeat &&
        old.dueAt !== null &&
        input.dueAt !== null &&
        Date.parse(old.dueAt) === Date.parse(input.dueAt);
      const v = this.validate(owner, input, now, preserveSchedule);
      if (old.status === 'completed' && v.enabled) throw new DomainError('请先重新打开已完成事项');
      const next = preserveSchedule
        ? old.nextAt
        : v.enabled && v.dueAt
          ? nextReminderAt(v.dueAt, v.repeat, now)
          : null;
      this.cancel(owner, id, now);
      this.database.connection
        .prepare(
          'UPDATE reminders SET name=?,content=?,due_at=?,repeat=?,template_ids=?,enabled=?,next_at=?,revision=revision+1,error=NULL,updated_at=? WHERE owner_uid=? AND id=?',
        )
        .run(
          v.name,
          v.content,
          v.dueAt ? Date.parse(v.dueAt) : null,
          v.repeat,
          JSON.stringify(v.templateIds),
          Number(v.enabled),
          next ? Date.parse(next) : null,
          now,
          owner,
          id,
        );
      return this.get(owner, id);
    });
  }
  setEnabled(owner: string, id: string, enabled: boolean, now = Date.now()): Reminder {
    if (!enabled) {
      return this.database.transaction(() => {
        this.get(owner, id);
        this.cancel(owner, id, now);
        this.database.connection
          .prepare(
            'UPDATE reminders SET enabled=0,next_at=NULL,revision=revision+1,error=NULL,updated_at=? WHERE owner_uid=? AND id=?',
          )
          .run(now, owner, id);
        return this.get(owner, id);
      });
    }
    const current = this.get(owner, id);
    // A paused reminder can outlive a deleted template. Recover only its saved,
    // still-owned references; ordinary create/update validation remains strict.
    const existing = new Set(
      this.notifications.listTemplates(owner).map((template) => template.id),
    );
    const templateIds = current.templateIds.filter((templateId) => existing.has(templateId));
    if (!templateIds.length) throw new DomainError('关联的通知模板已删除，请重新选择通知模板');
    return this.update(
      owner,
      id,
      {
        name: current.name,
        content: current.content,
        dueAt: current.dueAt,
        repeat: current.repeat,
        templateIds,
        enabled,
      },
      now,
    );
  }
  complete(owner: string, id: string, completed: boolean, now = Date.now()): Reminder {
    return this.database.transaction(() => {
      this.get(owner, id);
      this.cancel(owner, id, now);
      this.database.connection
        .prepare(
          'UPDATE reminders SET status=?,completed_at=?,enabled=0,next_at=NULL,revision=revision+1,error=NULL,updated_at=? WHERE owner_uid=? AND id=?',
        )
        .run(completed ? 'completed' : 'open', completed ? now : null, now, owner, id);
      return this.get(owner, id);
    });
  }
  batch(owner: string, ids: string[], action: 'complete' | 'pause' | 'delete', now = Date.now()) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !id || id.length > 80) ||
      !['complete', 'pause', 'delete'].includes(action)
    )
      throw new DomainError('批量操作参数无效');
    return this.database.transaction(() => {
      for (const id of ids) this.get(owner, id);
      for (const id of ids) {
        if (action === 'delete') this.remove(owner, id, now);
        else if (action === 'complete') this.complete(owner, id, true, now);
        else this.setEnabled(owner, id, false, now);
      }
      return { success: true, count: ids.length };
    });
  }
  remove(owner: string, id: string, now = Date.now()): void {
    this.database.transaction(() => {
      this.get(owner, id);
      this.cancel(owner, id, now);
      this.database.connection
        .prepare('DELETE FROM reminders WHERE owner_uid=? AND id=?')
        .run(owner, id);
    });
  }
  private cancel(owner: string, id: string, now: number) {
    this.database.connection
      .prepare(
        "UPDATE notification_deliveries SET status='cancelled',finished_at=?,next_attempt_at=NULL,error='提醒事项已变更' WHERE owner_uid=? AND event_type='reminder.due' AND event_id LIKE ? AND status='pending'",
      )
      .run(now, owner, `reminder:${id}:%`);
  }
  dispatchDue(now = Date.now()): number {
    return this.database.transaction(() => {
      const rows = this.database.connection
        .prepare(
          "SELECT * FROM reminders WHERE enabled=1 AND status='open' AND next_at<=? ORDER BY next_at,id LIMIT 100",
        )
        .all(now);
      let count = 0;
      for (const row of rows) {
        const v = this.decode(row),
          owner = String(row.owner_uid);
        const available = v.templateIds.filter((id) => {
          try {
            const t = this.notifications.getTemplate(owner, id);
            return t.enabled && notificationReady(t);
          } catch {
            return false;
          }
        });
        if (!available.length) {
          this.database.connection
            .prepare(
              "UPDATE reminders SET enabled=0,next_at=NULL,error='所选通知模板不可用',updated_at=? WHERE owner_uid=? AND id=?",
            )
            .run(now, owner, v.id);
          continue;
        }
        for (const templateId of available)
          this.notifications.enqueueReminder(
            owner,
            templateId,
            {
              id: v.id,
              revision: Number(row.revision),
              name: v.name,
              content: v.content,
              dueAt: v.nextAt!,
            },
            now,
          );
        const next = v.dueAt ? nextReminderAt(v.dueAt, v.repeat, now) : null;
        this.database.connection
          .prepare(
            'UPDATE reminders SET next_at=?,enabled=?,last_fired_at=?,error=NULL,updated_at=? WHERE owner_uid=? AND id=?',
          )
          .run(next ? Date.parse(next) : null, Number(!!next), now, now, owner, v.id);
        count++;
      }
      return count;
    });
  }
}
