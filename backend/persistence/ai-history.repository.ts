import { DomainError } from '../errors.js';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AiAttachmentFiles } from './ai-attachment-files.js';
import type { AiAttachment, AiAttachmentSummary } from '../domain/ai-attachments.js';
import type { AiStoredChat, AiChatSummary, AiProtocolMessage, AiProposal } from '../domain/ai.js';
import type { DatabaseService } from './database.service.js';
import { text, integer, optionalText, type RecordValue } from './records.js';
const metadata = (r: RecordValue): AiChatSummary => ({
  id: text(r.id),
  connectionId: text(r.connection_id),
  connectionName: text(r.connection_name),
  title: text(r.title),
  providerId: optionalText(r.provider_id) ?? undefined,
  model: optionalText(r.model) ?? undefined,
  createdAt: integer(r.created_at),
  updatedAt: integer(r.updated_at),
});
export class AiHistoryRepository {
  private readonly files: AiAttachmentFiles;
  private readonly logger = new Logger(AiHistoryRepository.name);
  private cleanFiles() {
    try {
      this.files.cleanUnreferenced(
        new Set(
          this.database.connection
            .prepare('SELECT storage_key FROM ai_chat_attachments WHERE deleted_at IS NULL')
            .all()
            .map((r) => text(r.storage_key)),
        ),
      );
      return true;
    } catch {
      this.logger.warn('附件清理未完成，将在下次保存或启动时重试');
      return false;
    }
  }
  constructor(private readonly database: DatabaseService) {
    this.files = new AiAttachmentFiles(database.dataDir);
    this.cleanFiles();
  }
  removeSelected(owner: string, ids: string[], protectedIds: string[]) {
    const count = this.database.transaction(() => {
      const rows = this.database.connection
        .prepare(
          'SELECT id FROM ai_chats WHERE owner_uid=? AND id IN(SELECT value FROM json_each(?))',
        )
        .all(owner, JSON.stringify(ids));
      if (rows.length !== ids.length) throw new DomainError('对话不存在或已清理', 404);
      if (ids.some((id) => protectedIds.includes(id)))
        throw new DomainError('所选对话正在使用，请先关闭会话或新建对话', 409);
      return this.database.connection
        .prepare('DELETE FROM ai_chats WHERE owner_uid=? AND id IN(SELECT value FROM json_each(?))')
        .run(owner, JSON.stringify(ids)).changes;
    });
    return { count: Number(count), cleanupPending: !this.cleanFiles() };
  }
  removeAvailable(owner: string, protectedIds: string[]) {
    const rows = this.database.connection
      .prepare(
        'DELETE FROM ai_chats WHERE owner_uid=? AND id NOT IN(SELECT value FROM json_each(?)) RETURNING id',
      )
      .all(owner, JSON.stringify(protectedIds));
    return { count: rows.length, cleanupPending: !this.cleanFiles() };
  }
  list(owner: string): AiChatSummary[] {
    return this.database.connection
      .prepare('SELECT * FROM ai_chats WHERE owner_uid=? ORDER BY updated_at DESC,id DESC LIMIT 50')
      .all(owner)
      .map(metadata);
  }
  get(owner: string, id: string): AiStoredChat | null {
    const c = this.database.connection,
      row = c.prepare('SELECT * FROM ai_chats WHERE owner_uid=? AND id=?').get(owner, id);
    if (!row) return null;
    const attachments = c
      .prepare(
        'SELECT * FROM ai_chat_attachments WHERE owner_uid=? AND chat_id=? ORDER BY protocol_position,position',
      )
      .all(owner, id);
    const attachmentSummary = (r: RecordValue): AiAttachmentSummary => ({
      id: text(r.id),
      name: text(r.name),
      kind: text(r.kind) as 'text' | 'image' | 'archive',
      mimeType: text(r.mime_type),
      size: integer(r.size),
      ...(r.deleted_at !== null ? { removed: true } : {}),
    });
    const attachmentContent = (r: RecordValue): AiAttachment => ({
      ...attachmentSummary(r),
      data: this.files
        .read(text(r.storage_key), integer(r.size), text(r.sha256))
        .toString(r.kind !== 'text' ? 'base64' : 'utf8'),
    });
    const messages = c
      .prepare('SELECT * FROM ai_chat_messages WHERE owner_uid=? AND chat_id=? ORDER BY position')
      .all(owner, id)
      .map((r) => ({
        id: text(r.id),
        role: text(r.role) as 'user' | 'assistant' | 'notice',
        content: text(r.content),
        ...(attachments.some((a) => a.message_id === r.id)
          ? { attachments: attachments.filter((a) => a.message_id === r.id).map(attachmentSummary) }
          : {}),
      }));
    const proposals: AiProposal[] = c
      .prepare('SELECT * FROM ai_chat_proposals WHERE owner_uid=? AND chat_id=? ORDER BY position')
      .all(owner, id)
      .map((r) => ({
        ...(r.action ? JSON.parse(text(r.action)) : {}),
        id: text(r.tool_call_id),
        messageId: text(r.message_id),
        proposalId: text(r.id),
        command: text(r.command),
        explanation: text(r.explanation),
        status: text(r.status) as AiProposal['status'],
        ...(r.result_status
          ? {
              result: {
                stdout: text(r.stdout),
                stderr: text(r.stderr),
                exitCode: r.exit_code === null ? null : integer(r.exit_code),
                status: text(r.result_status) as 'success' | 'failed' | 'timeout' | 'cancelled',
                truncated: !!r.truncated,
              },
            }
          : {}),
      }));
    const history: AiProtocolMessage[] = c
      .prepare('SELECT * FROM ai_chat_protocol WHERE owner_uid=? AND chat_id=? ORDER BY position')
      .all(owner, id)
      .map((r) => {
        const role = text(r.role);
        if (role === 'tool')
          return { role, content: text(r.content), tool_call_id: text(r.tool_call_id) };
        if (role === 'assistant')
          return {
            role,
            content: optionalText(r.content),
            ...(r.reasoning ? JSON.parse(text(r.reasoning)) : {}),
            ...(r.tool_calls ? { tool_calls: JSON.parse(text(r.tool_calls)) } : {}),
          };
        if (role === 'user') {
          const files = attachments
            .filter((a) => a.protocol_position === r.position && a.deleted_at === null)
            .map(attachmentContent);
          return {
            role,
            content: text(r.content),
            ...(files.length ? { attachments: files } : {}),
          };
        }
        if (role === 'system') return { role, content: text(r.content) };
        throw Error('AI 历史角色无效');
      });
    return { ...metadata(row), owner, messages, proposals, history };
  }
  save(chat: AiStoredChat, protectedIds: string[] = []): void {
    if (!chat.messages.length) return;
    const written: string[] = [];
    try {
      this.database.transaction(() => {
        const c = this.database.connection;
        const latest = c
          .prepare(
            'SELECT updated_at FROM ai_chats WHERE owner_uid=? ORDER BY updated_at DESC LIMIT 1',
          )
          .get(chat.owner);
        // Writes within one millisecond must retain their actual order for listing and pruning.
        const updatedAt = latest
          ? Math.max(chat.updatedAt, integer(latest.updated_at) + 1)
          : chat.updatedAt;
        c.prepare(
          `INSERT INTO ai_chats(id,owner_uid,connection_id,connection_name,title,provider_id,model,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id)DO UPDATE SET title=excluded.title,provider_id=excluded.provider_id,model=excluded.model,updated_at=excluded.updated_at WHERE ai_chats.owner_uid=excluded.owner_uid`,
        ).run(
          chat.id,
          chat.owner,
          chat.connectionId,
          chat.connectionName,
          chat.title,
          chat.providerId ?? null,
          chat.model ?? null,
          chat.createdAt,
          updatedAt,
        );
        const msg = c.prepare(
          `INSERT INTO ai_chat_messages(owner_uid,chat_id,id,position,role,content)VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,id)DO UPDATE SET content=excluded.content`,
        );
        chat.messages.forEach((m, i) => msg.run(chat.owner, chat.id, m.id, i, m.role, m.content));
        const prop = c.prepare(
          `INSERT INTO ai_chat_proposals(owner_uid,chat_id,id,message_id,tool_call_id,command,explanation,position,status,stdout,stderr,exit_code,result_status,truncated,action)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,id)DO UPDATE SET status=excluded.status,stdout=excluded.stdout,stderr=excluded.stderr,exit_code=excluded.exit_code,result_status=excluded.result_status,truncated=excluded.truncated,action=excluded.action`,
        );
        chat.proposals.forEach((p, i) =>
          prop.run(
            chat.owner,
            chat.id,
            p.proposalId,
            p.messageId,
            p.id,
            p.command,
            p.explanation,
            i,
            p.status,
            p.result?.stdout ?? null,
            p.result?.stderr ?? null,
            p.result?.exitCode ?? null,
            p.result?.status ?? null,
            p.result ? Number(p.result.truncated) : null,
            p.kind === 'install_skill_package'
              ? JSON.stringify({ kind: p.kind, previewId: p.previewId })
              : p.kind === 'prepare_skill_runtime'
                ? JSON.stringify({ kind: p.kind, skill: p.skill, packageRef: p.packageRef })
                : p.skillRefs?.length
                  ? JSON.stringify({ kind: 'ssh_command', skillRefs: p.skillRefs })
                  : null,
          ),
        );
        const protocol = c.prepare(
          `INSERT INTO ai_chat_protocol(owner_uid,chat_id,position,role,content,tool_call_id,tool_calls,reasoning)VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,position)DO UPDATE SET role=excluded.role,content=excluded.content,tool_call_id=excluded.tool_call_id,tool_calls=excluded.tool_calls,reasoning=excluded.reasoning`,
        );
        chat.history.forEach((m, i) =>
          protocol.run(
            chat.owner,
            chat.id,
            i,
            m.role,
            m.content,
            m.role === 'tool' ? m.tool_call_id : null,
            m.role === 'assistant' && m.tool_calls ? JSON.stringify(m.tool_calls) : null,
            m.role === 'assistant' &&
              (m.reasoning_content || m.reasoning_details || m.provider_content)
              ? JSON.stringify({
                  ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
                  ...(m.provider_content ? { provider_content: m.provider_content } : {}),
                  ...(m.reasoning_details ? { reasoning_details: m.reasoning_details } : {}),
                })
              : null,
          ),
        );
        const existingAttachments = new Set(
          c
            .prepare('SELECT id FROM ai_chat_attachments WHERE owner_uid=? AND chat_id=?')
            .all(chat.owner, chat.id)
            .map((r) => text(r.id)),
        );
        const insertAttachment = c.prepare(
          'INSERT INTO ai_chat_attachments(owner_uid,chat_id,id,message_id,protocol_position,position,name,kind,mime_type,size,storage_key,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        );
        const messageIds = new Map(
          chat.messages.flatMap((m) => (m.attachments || []).map((a) => [a.id, m.id] as const)),
        );
        chat.history.forEach((m, i) => {
          if (m.role !== 'user') return;
          (m.attachments || []).forEach((a, position) => {
            if (existingAttachments.has(a.id)) return;
            const messageId = messageIds.get(a.id);
            if (!messageId) throw Error('附件缺少所属消息');
            const bytes = Buffer.from(a.data, a.kind !== 'text' ? 'base64' : 'utf8');
            this.files.write(a.id, bytes);
            written.push(a.id);
            insertAttachment.run(
              chat.owner,
              chat.id,
              a.id,
              messageId,
              i,
              position,
              a.name,
              a.kind,
              a.mimeType,
              a.size,
              a.id,
              createHash('sha256').update(bytes).digest('hex'),
              Date.now(),
            );
          });
        });
        const active = [...new Set([...protectedIds, chat.id])];
        const marks = active.map(() => '?').join(',');
        const activeCount = Number(
          c
            .prepare(`SELECT count(*) n FROM ai_chats WHERE owner_uid=? AND id IN (${marks})`)
            .get(chat.owner, ...active)?.n,
        );
        c.prepare(
          `DELETE FROM ai_chats WHERE owner_uid=? AND id NOT IN (${marks}) AND id NOT IN
        (SELECT id FROM ai_chats WHERE owner_uid=? AND id NOT IN (${marks}) ORDER BY updated_at DESC,id DESC LIMIT ?)`,
        ).run(chat.owner, ...active, chat.owner, ...active, Math.max(0, 50 - activeCount));
      });
    } catch (error) {
      for (const key of written) {
        try {
          this.files.remove(key);
        } catch {
          this.logger.warn('附件回滚清理未完成，将在下次保存或启动时重试');
        }
      }
      throw error;
    }
    this.cleanFiles();
  }
}
