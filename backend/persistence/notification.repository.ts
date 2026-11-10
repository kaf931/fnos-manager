import { NotificationInboxRepository } from './notification-inbox.repository.js';
import {
  DEFAULT_NOTIFICATION_OPTIONS,
  notificationReady,
  NOTIFICATION_CHANNELS,
} from '../domain/notifications.js';
import { validateNotificationOptions, prepareNotification } from '../notifications/channels.js';
import { RetentionRepository } from './retention.repository.js';
import { randomUUID } from 'node:crypto';
import type {
  NotificationSettings,
  NotificationSettingsInput,
  NotificationOptions,
  NotificationDelivery,
  NotificationDeliveryPage,
  NotificationTemplate,
  NotificationTemplateInput,
  NotificationTemplateSummary,
} from '../domain/notifications.js';
import type { TaskRecord, TaskRun } from '../domain/tasks.js';
import type { RecordValue } from './records.js';
import type { DatabaseService } from './database.service.js';
const defaults: NotificationSettings = {
  ...DEFAULT_NOTIFICATION_OPTIONS,
  enabled: false,
  url: '',
  token: '',
  condition: 'errors',
  scanFailures: true,
};
const iso = (v: unknown) => (v == null ? null : new Date(Number(v)).toISOString());
function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
export function validateSettings(input: NotificationSettingsInput): NotificationSettings {
  if (
    !input ||
    typeof input.enabled !== 'boolean' ||
    typeof input.scanFailures !== 'boolean' ||
    !['all', 'errors'].includes(input.condition) ||
    typeof input.url !== 'string' ||
    typeof input.token !== 'string'
  )
    invalid('通知设置格式无效');
  const options = validateNotificationOptions(input);
  if (['serverchan', 'bark'].includes(options.channel) && input.enabled && !input.token)
    invalid('当前渠道需要填写推送凭据');
  if (
    options.channel === 'serverchan' &&
    input.token &&
    !/^(?:SCT[A-Za-z0-9_-]+|sctp\d+t[A-Za-z0-9_-]+)$/.test(input.token)
  )
    invalid('SendKey 格式无效');
  if (
    input.token &&
    options.channel === 'webhook' &&
    Object.keys(options.headers).includes('authorization')
  )
    invalid('Bearer Token 与 Authorization 请求头只能设置一项');
  if (
    input.url.length > 2048 ||
    input.token.length > 4096 ||
    /[\r\n\x00-\x1f\x7f]/.test(input.token)
  )
    invalid('通知地址或凭据无效');
  if (
    input.url !== input.url.trim() ||
    input.url.includes('#') ||
    /^https?:\/\/[^/]*@/i.test(input.url)
  )
    invalid('通知地址禁止用户信息、片段或空白');
  if (input.url) {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      invalid('请输入有效的 HTTP(S) 地址');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
      invalid('通知地址禁止用户信息、片段或非 HTTP(S) 协议');
  } else if (input.enabled && !['email', 'serverchan', 'inapp'].includes(options.channel))
    invalid('启用通知需要填写地址');
  return {
    ...options,
    enabled: input.enabled,
    url: input.url,
    token: input.token,
    condition: input.condition,
    scanFailures: input.scanFailures,
  };
}
export interface ClaimedDelivery {
  id: string;
  templateId?: string;
  owner: string;
  revision: number;
  attempts: number;
  url: string;
  token: string;
  payload: string;
  options?: NotificationOptions;
}
export class NotificationRepository {
  constructor(private readonly database: DatabaseService) {}
  inbox(owner: string, page = 1, pageSize = 10, filter: 'all' | 'unread' = 'all', q = '') {
    return new NotificationInboxRepository(this.database).list(owner, page, pageSize, filter, q);
  }
  inboxUnread(owner: string) {
    return new NotificationInboxRepository(this.database).unread(owner);
  }
  readInbox(owner: string, ids?: string[]) {
    return new NotificationInboxRepository(this.database).read(owner, ids);
  }
  private row(owner: string, id: string) {
    return this.database.connection
      .prepare('SELECT * FROM notification_templates WHERE owner_uid=? AND id=?')
      .get(owner, id);
  }
  private decodeTemplate(row: RecordValue): NotificationTemplate {
    const stored = JSON.parse(String(row.config));
    const settings = Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, stored[key] ?? value]),
    ) as unknown as NotificationSettings;
    return {
      ...settings,
      enabled: NOTIFICATION_CHANNELS.includes(settings.channel) && settings.enabled,
      id: String(row.id),
      name: String(row.name),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    };
  }
  templateOrder(owner: string): { keys: string[] } {
    const row = this.database.connection
      .prepare('SELECT entries FROM notification_template_order WHERE owner_uid=?')
      .get(owner);
    return { keys: row ? JSON.parse(String(row.entries)) : [] };
  }
  saveTemplateOrder(owner: string, keys: string[]): { keys: string[] } {
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > 100 ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => typeof key !== 'string' || key.length > 100)
    )
      invalid('模板排序无效');
    return this.database.transaction(() => {
      const templates = this.listTemplates(owner);
      const channels = new Set(NOTIFICATION_CHANNELS.map((channel) => 'channel:' + channel));
      const templateKeys = new Map(templates.map((row) => ['template:' + row.id, row.channel]));
      if (keys.some((key) => !channels.has(key) && !templateKeys.has(key)))
        invalid('模板已变更，请刷新后重试');
      const saved: string[] = [];
      for (const key of keys) {
        if (!saved.includes(key)) saved.push(key);
        const channel = templateKeys.get(key);
        const fallback = channel && 'channel:' + channel;
        if (
          fallback &&
          channels.has(fallback) &&
          !keys.includes(fallback) &&
          !saved.includes(fallback)
        )
          saved.push(fallback);
      }
      this.database.connection
        .prepare(
          'INSERT INTO notification_template_order(owner_uid,entries) VALUES(?,?) ON CONFLICT(owner_uid) DO UPDATE SET entries=excluded.entries',
        )
        .run(owner, JSON.stringify(saved));
      return { keys: saved };
    });
  }
  listTemplates(owner: string): NotificationTemplateSummary[] {
    return this.database.connection
      .prepare('SELECT * FROM notification_templates WHERE owner_uid=? ORDER BY created_at,id')
      .all(owner)
      .map((row) => {
        const {
          token: _token,
          signingSecret: _secret,
          headers: _headers,
          ...value
        } = this.decodeTemplate(row);
        return { ...value, ready: notificationReady(this.decodeTemplate(row)) };
      });
  }
  getTemplate(owner: string, id: string): NotificationTemplate {
    const row = this.row(owner, id);
    if (!row) throw Object.assign(new Error('通知模板不存在'), { status: 404 });
    return this.decodeTemplate(row);
  }
  createTemplate(owner: string, input: NotificationTemplateInput): NotificationTemplate {
    if (this.listTemplates(owner).length >= 50) invalid('最多创建 50 个通知模板');
    return this.persist(owner, randomUUID(), input, true);
  }
  updateTemplate(
    owner: string,
    id: string,
    input: NotificationTemplateInput,
  ): NotificationTemplate {
    this.getTemplate(owner, id);
    return this.persist(owner, id, input, false);
  }
  private persist(
    owner: string,
    id: string,
    input: NotificationTemplateInput,
    create: boolean,
  ): NotificationTemplate {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name))
      invalid('请输入不超过 80 个字的模板名称');
    const value = validateSettings(input);
    if (notificationReady(value))
      prepareNotification({
        ...value,
        payload: JSON.stringify({
          name: '通知测试',
          status: 'test',
          eventType: 'test',
          eventId: 'preview',
          finishedAt: new Date().toISOString(),
        }),
      });
    return this.database.transaction(() => {
      const db = this.database.connection;
      if (
        db
          .prepare('SELECT id FROM notification_templates WHERE owner_uid=? AND name=? AND id!=?')
          .get(owner, name, id)
      )
        invalid('模板名称已存在');
      const now = Date.now();
      if (create)
        db.prepare('INSERT INTO notification_templates VALUES(?,?,?,?,1,?,?)').run(
          id,
          owner,
          name,
          JSON.stringify(value),
          now,
          now,
        );
      else {
        const old = this.getTemplate(owner, id);
        if (!value.enabled && old.enabled) this.assertTemplateUnused(owner, id);
        const changed = JSON.stringify(validateSettings(old)) !== JSON.stringify(value);
        db.prepare(
          'UPDATE notification_templates SET name=?,config=?,revision=revision+?,updated_at=? WHERE owner_uid=? AND id=?',
        ).run(name, JSON.stringify(value), Number(changed), now, owner, id);
        if (changed)
          db.prepare(
            "UPDATE notification_deliveries SET status='cancelled',finished_at=?,next_attempt_at=NULL,error='模板已变更' WHERE owner_uid=? AND template_id=? AND status='pending'",
          ).run(now, owner, id);
      }
      this.trim(owner);
      return this.getTemplate(owner, id);
    });
  }
  setTemplateEnabled(owner: string, id: string, enabled: boolean): NotificationTemplate {
    return this.updateTemplate(owner, id, { ...this.getTemplate(owner, id), enabled });
  }
  private assertTemplateUnused(owner: string, id: string): void {
    if (
      this.database.connection
        .prepare(
          "SELECT 1 FROM reminders r,json_each(r.template_ids) j WHERE r.owner_uid=? AND r.enabled=1 AND r.status='open' AND j.value=? LIMIT 1",
        )
        .get(owner, id)
    )
      invalid('此模板正在用于提醒事项，请先暂停或调整提醒');
  }
  deleteTemplate(owner: string, id: string): void {
    this.assertTemplateUnused(owner, id);
    this.getTemplate(owner, id);
    this.database.transaction(() => {
      this.database.connection
        .prepare(
          "UPDATE notification_deliveries SET status='cancelled',finished_at=?,next_attempt_at=NULL,error='模板已删除' WHERE owner_uid=? AND template_id=? AND status='pending'",
        )
        .run(Date.now(), owner, id);
      this.database.connection
        .prepare('DELETE FROM notification_templates WHERE owner_uid=? AND id=?')
        .run(owner, id);
    });
  }
  getSettings(owner: string): NotificationSettings {
    const row = this.row(owner, 'default');
    return row ? this.decodeTemplate(row) : { ...defaults, headers: {} };
  }
  saveSettings(owner: string, input: NotificationSettingsInput): NotificationSettings {
    const row = this.row(owner, 'default');
    return this.persist(
      owner,
      'default',
      { ...input, name: row ? String(row.name) : '默认通知' },
      !row,
    );
  }
  private decode(row: RecordValue): NotificationDelivery {
    return {
      id: String(row.id),
      templateId: String(row.template_id),
      channel: row.channel as NotificationDelivery['channel'],
      templateName: String(row.template_name || ''),
      eventId: String(row.event_id),
      eventType: row.event_type as NotificationDelivery['eventType'],
      name: String(row.name),
      status: row.status as NotificationDelivery['status'],
      attempts: Number(row.attempts),
      createdAt: iso(row.created_at)!,
      finishedAt: iso(row.finished_at),
      nextAttemptAt: iso(row.next_attempt_at),
      httpStatus: row.http_status == null ? null : Number(row.http_status),
      error: row.error == null ? null : String(row.error),
    };
  }
  deliveries(
    owner: string,
    page = 1,
    pageSize = 10,
    filters: { templateId?: string; reminderId?: string } = {},
  ): NotificationDeliveryPage {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)
    )
      invalid('分页参数无效');
    const db = this.database.connection;
    const where =
      'owner_uid=?' +
      (filters.templateId ? ' AND template_id=?' : '') +
      (filters.reminderId
        ? " AND event_type='reminder.due' AND json_extract(payload,'$.reminderId')=?"
        : '');
    const args = [
      owner,
      ...(filters.templateId ? [filters.templateId] : []),
      ...(filters.reminderId ? [filters.reminderId] : []),
    ];
    return {
      items: db
        .prepare(
          `SELECT * FROM notification_deliveries WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, (page - 1) * pageSize)
        .map((r) => this.decode(r)),
      total: Number(
        db.prepare(`SELECT count(*) n FROM notification_deliveries WHERE ${where}`).get(...args)?.n,
      ),
      page,
      pageSize,
    };
  }
  private enqueue(
    owner: string,
    templateId: string,
    eventId: string,
    eventType: NotificationDelivery['eventType'],
    name: string,
    summary: Record<string, unknown>,
    enqueuedAt = Date.now(),
  ): NotificationDelivery {
    return this.database.transaction(() => {
      const db = this.database.connection,
        setting = this.row(owner, templateId);
      if (!setting) invalid('通知模板不存在');
      const previous = db
        .prepare(
          'SELECT * FROM notification_deliveries WHERE owner_uid=? AND template_id=? AND event_id=?',
        )
        .get(owner, templateId, eventId);
      if (previous) return this.decode(previous);
      const count = Number(
        db
          .prepare(
            "SELECT count(*) n FROM notification_deliveries WHERE owner_uid=? AND status IN ('pending','sending')",
          )
          .get(owner)?.n,
      );
      const overflow = count >= 500,
        id = randomUUID(),
        now = enqueuedAt,
        safeName = name.slice(0, 120);
      const settings = this.decodeTemplate(setting);
      const payload = { eventId, eventType, name: safeName, ...summary };
      const content =
        settings.channel === 'inapp'
          ? (JSON.parse(prepareNotification({ ...settings, payload: JSON.stringify(payload) }).body)
              .text as string)
          : undefined;
      db.prepare(
        'INSERT INTO notification_deliveries(id,owner_uid,template_id,template_name,channel,event_id,event_type,name,payload,revision,status,created_at,finished_at,next_attempt_at,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        owner,
        templateId,
        String(setting.name),
        this.getTemplate(owner, templateId).channel,
        eventId,
        eventType,
        safeName,
        JSON.stringify({ ...payload, ...(content === undefined ? {} : { message: content }) }),
        Number(setting.revision),
        overflow ? 'failed' : 'pending',
        now,
        overflow ? now : null,
        overflow ? null : now,
        overflow ? '投递队列已满' : null,
      );
      this.trim(owner);
      return this.decode(db.prepare('SELECT * FROM notification_deliveries WHERE id=?').get(id)!);
    });
  }
  enqueueReminder(
    owner: string,
    templateId: string,
    reminder: { id: string; revision: number; name: string; content: string; dueAt: string },
    now = Date.now(),
  ): NotificationDelivery {
    return this.enqueue(
      owner,
      templateId,
      `reminder:${reminder.id}:${reminder.revision}:${reminder.dueAt}`,
      'reminder.due',
      reminder.name,
      {
        status: 'reminder',
        content: reminder.content,
        dueAt: reminder.dueAt,
        reminderId: reminder.id,
        reminderRevision: reminder.revision,
        finishedAt: new Date(now).toISOString(),
      },
      now,
    );
  }
  enqueueTest(owner: string, templateId = 'default'): NotificationDelivery {
    const s = this.getTemplate(owner, templateId);
    if (!notificationReady(s)) invalid('请先保存完整的通知配置');
    return this.enqueue(owner, templateId, randomUUID(), 'test', '通知测试', {
      status: 'test',
      finishedAt: new Date().toISOString(),
    });
  }
  taskResult(task: TaskRecord, run: TaskRun): void {
    if (run.status === 'running') return;
    const rows = task.ownerUid
      ? this.database.connection
          .prepare('SELECT * FROM notification_templates WHERE owner_uid=?')
          .all(task.ownerUid)
      : this.database.connection.prepare('SELECT * FROM notification_templates').all();
    for (const row of rows) {
      const s = this.decodeTemplate(row);
      if (!s.enabled || (s.condition === 'errors' && run.status === 'success')) continue;
      this.enqueue(String(row.owner_uid), s.id, `task:${run.id}`, 'task.result', task.name, {
        status: run.status,
        taskType: task.type,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        exitCode: run.code ?? null,
      });
    }
  }
  scanResult(item: RecordValue): void {
    if (!['failed', 'error', 'interrupted'].includes(String(item.status))) return;
    const owner = String(item.owner);
    for (const row of this.database.connection
      .prepare('SELECT * FROM notification_templates WHERE owner_uid=?')
      .all(owner)) {
      const s = this.decodeTemplate(row);
      if (s.enabled && s.scanFailures)
        this.enqueue(
          owner,
          s.id,
          `scan:${String(item.id)}`,
          'scan.failed',
          item.mode === 'duplicates' ? '重复文件扫描' : '空间扫描',
          {
            status: String(item.status),
            startedAt: item.startedAt ?? null,
            finishedAt: item.finishedAt ?? null,
          },
        );
    }
  }
  recover(): void {
    this.database.transaction(() => {
      const db = this.database.connection;
      db.prepare(
        "UPDATE notification_deliveries SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,next_attempt_at=?,finished_at=CASE WHEN attempts>=3 THEN ? ELSE NULL END,error='上次投递被中断' WHERE status='sending'",
      ).run(Date.now(), Date.now());
      this.cancelStale();
      for (const row of db.prepare('SELECT DISTINCT owner_uid FROM notification_deliveries').all())
        this.trim(String(row.owner_uid));
    });
  }
  private cancelStale(): void {
    this.database.connection
      .prepare(
        `UPDATE notification_deliveries SET status='cancelled',finished_at=?,next_attempt_at=NULL,error='通知渠道已移除' WHERE status='pending' AND channel NOT IN (${NOTIFICATION_CHANNELS.map(() => '?').join(',')})`,
      )
      .run(Date.now(), ...NOTIFICATION_CHANNELS);
    this.database.connection
      .prepare(
        "UPDATE notification_deliveries SET status='cancelled',finished_at=?,next_attempt_at=NULL,error='模板已变更或删除' WHERE status='pending' AND NOT EXISTS(SELECT 1 FROM notification_templates s WHERE s.owner_uid=notification_deliveries.owner_uid AND s.id=notification_deliveries.template_id AND s.revision=notification_deliveries.revision)",
      )
      .run(Date.now());
    this.database.connection
      .prepare(
        "UPDATE notification_deliveries SET status='cancelled',finished_at=?,next_attempt_at=NULL,error='提醒事项已变更或删除' WHERE status='pending' AND event_type='reminder.due' AND NOT EXISTS(SELECT 1 FROM reminders r WHERE r.owner_uid=notification_deliveries.owner_uid AND r.id=json_extract(notification_deliveries.payload,'$.reminderId') AND r.revision=json_extract(notification_deliveries.payload,'$.reminderRevision') AND r.status='open')",
      )
      .run(Date.now());
  }
  claim(now = Date.now()): ClaimedDelivery | undefined {
    return this.database.transaction(() => {
      this.cancelStale();
      const db = this.database.connection;
      const row = db
        .prepare(
          "SELECT d.*,s.config FROM notification_deliveries d JOIN notification_templates s ON s.owner_uid=d.owner_uid AND s.id=d.template_id AND s.revision=d.revision WHERE d.status='pending' AND d.next_attempt_at<=? ORDER BY d.created_at,d.id LIMIT 1",
        )
        .get(now);
      if (!row) return;
      db.prepare(
        "UPDATE notification_deliveries SET status='sending',attempts=attempts+1,next_attempt_at=NULL WHERE id=?",
      ).run(String(row.id));
      const settings = { ...defaults, ...JSON.parse(String(row.config)) } as NotificationSettings;
      return {
        id: String(row.id),
        owner: String(row.owner_uid),
        templateId: String(row.template_id),
        revision: Number(row.revision),
        attempts: Number(row.attempts) + 1,
        url: settings.url,
        token: settings.token,
        payload: String(row.payload),
        options: settings,
      };
    });
  }
  finish(
    job: ClaimedDelivery,
    httpStatus: number | null,
    retryable: boolean,
    now = Date.now(),
    deliveryError?: string,
  ): void {
    this.database.transaction(() => {
      const db = this.database.connection,
        current = this.row(job.owner, job.templateId || 'default');
      const success =
        !deliveryError && httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
      const event = JSON.parse(job.payload) as {
        eventType?: string;
        reminderId?: string;
        reminderRevision?: number;
      };
      const reminder =
        event.eventType === 'reminder.due'
          ? db
              .prepare('SELECT revision,status FROM reminders WHERE owner_uid=? AND id=?')
              .get(job.owner, event.reminderId || '')
          : undefined;
      const sourceStale =
        event.eventType === 'reminder.due' &&
        (!reminder ||
          reminder.status !== 'open' ||
          Number(reminder.revision) !== event.reminderRevision);
      const stale = sourceStale || Number(current?.revision) !== job.revision,
        retry = !success && !stale && retryable && job.attempts < 3;
      db.prepare(
        "UPDATE notification_deliveries SET status=?,finished_at=?,next_attempt_at=?,http_status=?,error=? WHERE id=? AND status='sending'",
      ).run(
        success ? 'success' : stale ? 'cancelled' : retry ? 'pending' : 'failed',
        retry ? null : now,
        retry ? now + (job.attempts === 1 ? 30000 : 120000) : null,
        httpStatus,
        success
          ? null
          : stale
            ? '模板已变更'
            : deliveryError || (httpStatus === null ? '网络请求失败或超时' : `HTTP ${httpStatus}`),
        job.id,
      );
      this.trim(job.owner);
    });
  }
  private trim(owner: string): void {
    this.database.connection
      .prepare(
        "DELETE FROM notification_deliveries WHERE id IN(SELECT id FROM notification_deliveries WHERE owner_uid=? AND status IN ('success','failed','cancelled') ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET ?)",
      )
      .run(owner, new RetentionRepository(this.database).limits().deliveries);
  }
}
