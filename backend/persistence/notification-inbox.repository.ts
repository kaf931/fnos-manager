import type { InboxPage } from '../domain/notifications.js';
import { DomainError } from '../errors.js';
import type { DatabaseService } from './database.service.js';
const scope = "owner_uid=? AND channel='inapp' AND status='success'";
export class NotificationInboxRepository {
  constructor(private readonly database: DatabaseService) {}
  unread(owner: string): number {
    return Number(
      this.database.connection
        .prepare(
          `SELECT count(*) n FROM notification_deliveries WHERE ${scope} AND read_at IS NULL`,
        )
        .get(owner)?.n,
    );
  }
  list(
    owner: string,
    page = 1,
    pageSize = 10,
    filter: 'all' | 'unread' = 'all',
    q = '',
  ): InboxPage {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize) ||
      !['all', 'unread'].includes(filter)
    )
      throw new DomainError('分页参数无效');
    if (typeof q !== 'string' || q.length > 200) throw new DomainError('搜索内容过长');
    const where =
      scope +
      (filter === 'unread' ? ' AND read_at IS NULL' : '') +
      (q.trim()
        ? " AND (instr(lower(name),lower(?))>0 OR instr(lower(COALESCE(json_extract(payload,'$.message'),'')),lower(?))>0)"
        : '');
    const args = q.trim() ? [owner, q.trim(), q.trim()] : [owner];
    const c = this.database.connection;
    return {
      page,
      pageSize,
      total: Number(
        c.prepare(`SELECT count(*) n FROM notification_deliveries WHERE ${where}`).get(...args)?.n,
      ),
      items: c
        .prepare(
          `SELECT id,name,payload,template_name,created_at,read_at FROM notification_deliveries WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, (page - 1) * pageSize)
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          content: String(JSON.parse(String(row.payload)).message ?? ''),
          templateName: String(row.template_name),
          createdAt: new Date(Number(row.created_at)).toISOString(),
          readAt: row.read_at == null ? null : new Date(Number(row.read_at)).toISOString(),
          status: 'success',
        })),
    };
  }
  read(owner: string, ids?: string[]): { success: true } {
    if (
      ids &&
      (!ids.length ||
        ids.length > 200 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string' || !id || id.length > 128))
    )
      throw new DomainError('消息选择无效');
    return this.database.transaction(() => {
      const c = this.database.connection,
        selected = ids ? ' AND id IN (SELECT value FROM json_each(?))' : '',
        args = ids ? [owner, JSON.stringify(ids)] : [owner];
      if (
        ids &&
        Number(
          c
            .prepare(`SELECT count(*) n FROM notification_deliveries WHERE ${scope}${selected}`)
            .get(...args)?.n,
        ) !== ids.length
      )
        throw new DomainError('部分消息不存在，请刷新后重试', 409);
      c.prepare(
        `UPDATE notification_deliveries SET read_at=COALESCE(read_at,?) WHERE ${scope}${selected}`,
      ).run(Date.now(), ...args);
      return { success: true };
    });
  }
}
