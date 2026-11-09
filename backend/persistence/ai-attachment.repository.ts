import type {
  AiAttachmentQuery,
  AiAttachmentPage,
  AiAttachmentCleanup,
} from '../domain/ai-attachments.js';
import { DomainError } from '../errors.js';
import { AiAttachmentFiles } from './ai-attachment-files.js';
import type { DatabaseService } from './database.service.js';
import { integer, text } from './records.js';
export class AiAttachmentRepository {
  private readonly files: AiAttachmentFiles;
  constructor(private readonly database: DatabaseService) {
    this.files = new AiAttachmentFiles(database.dataDir);
  }
  preview(owner: string, id: string): { mimeType: string; data: string } {
    const row = this.database.connection
      .prepare(
        "SELECT storage_key,size,sha256,mime_type FROM ai_chat_attachments WHERE owner_uid=? AND id=? AND kind='image' AND deleted_at IS NULL",
      )
      .get(owner, id);
    if (!row || !['image/png', 'image/jpeg', 'image/webp'].includes(text(row.mime_type)))
      throw new DomainError('图片不存在或已清理', 404);
    try {
      return {
        mimeType: text(row.mime_type),
        data: this.files
          .read(text(row.storage_key), integer(row.size), text(row.sha256))
          .toString('base64'),
      };
    } catch {
      throw new DomainError('图片不可用，请重新上传', 404);
    }
  }
  list(owner: string, query: AiAttachmentQuery): AiAttachmentPage {
    const c = this.database.connection,
      page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    const where = ['a.owner_uid=?', 'a.deleted_at IS NULL'];
    const params: (string | number)[] = [owner];
    if (query.search?.trim()) {
      where.push('(instr(lower(a.name),lower(?))>0 OR instr(lower(c.title),lower(?))>0)');
      params.push(query.search.trim(), query.search.trim());
    }
    if (query.kind && query.kind !== 'all') {
      where.push('a.kind=?');
      params.push(query.kind);
    }
    if (query.olderThanDays) {
      where.push('a.created_at<?');
      params.push(Date.now() - query.olderThanDays * 86400000);
    }
    const from =
      ' FROM ai_chat_attachments a JOIN ai_chats c ON a.chat_id=c.id WHERE ' + where.join(' AND ');
    const total = integer(c.prepare('SELECT count(*) n' + from).get(...params)!.n);
    const summary = c
      .prepare(
        'SELECT count(*) n,coalesce(sum(size),0) bytes FROM ai_chat_attachments WHERE owner_uid=? AND deleted_at IS NULL',
      )
      .get(owner)!;
    return {
      items: c
        .prepare(
          'SELECT a.*,c.title' + from + ' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?',
        )
        .all(...params, pageSize, (page - 1) * pageSize)
        .map((r) => ({
          id: text(r.id),
          name: text(r.name),
          kind: text(r.kind) as 'text' | 'image' | 'archive',
          mimeType: text(r.mime_type),
          size: integer(r.size),
          chatId: text(r.chat_id),
          chatTitle: text(r.title),
          createdAt: integer(r.created_at),
        })),
      total,
      page,
      pageSize,
      summary: { count: integer(summary.n), bytes: integer(summary.bytes) },
    };
  }
  remove(owner: string, ids: string[], protectedChats: string[]): AiAttachmentCleanup {
    const selected = [...new Set(ids)];
    if (!selected.length || selected.length > 200)
      throw new DomainError('请选择 1 至 200 个附件', 400);
    const marks = selected.map(() => '?').join(','),
      c = this.database.connection;
    const rows = c
      .prepare(
        `SELECT id,chat_id,size FROM ai_chat_attachments WHERE owner_uid=? AND deleted_at IS NULL AND id IN (${marks})`,
      )
      .all(owner, ...selected);
    if (rows.length !== selected.length) throw new DomainError('附件不存在或已清理', 404);
    if (rows.some((r) => protectedChats.includes(text(r.chat_id))))
      throw new DomainError('部分附件正在被 AI 处理，请停止或完成当前操作后再清理', 409);
    this.database.transaction(() => {
      c.prepare(
        `UPDATE ai_chat_attachments SET deleted_at=? WHERE owner_uid=? AND id IN (${marks})`,
      ).run(Date.now(), owner, ...selected);
    });
    let cleanupPending = false;
    try {
      this.cleanOrphans();
    } catch {
      cleanupPending = true;
    }
    return {
      count: rows.length,
      bytes: rows.reduce((n, r) => n + integer(r.size), 0),
      cleanupPending,
    };
  }
  removeAvailable(owner: string, protectedChats: string[]) {
    const rows = this.database.connection
      .prepare(
        'UPDATE ai_chat_attachments SET deleted_at=? WHERE owner_uid=? AND deleted_at IS NULL AND chat_id NOT IN(SELECT value FROM json_each(?)) RETURNING id,size',
      )
      .all(Date.now(), owner, JSON.stringify(protectedChats));
    let cleanupPending = false;
    try {
      this.cleanOrphans();
    } catch {
      cleanupPending = true;
    }
    return {
      ids: rows.map((r) => text(r.id)),
      count: rows.length,
      bytes: rows.reduce((n, r) => n + integer(r.size), 0),
      cleanupPending,
    };
  }
  cleanOrphans(): AiAttachmentCleanup {
    const live = new Set(
      this.database.connection
        .prepare('SELECT storage_key FROM ai_chat_attachments WHERE deleted_at IS NULL')
        .all()
        .map((r) => text(r.storage_key)),
    );
    const result = this.files.cleanUnreferenced(live);
    return { ...result, cleanupPending: false };
  }
}
