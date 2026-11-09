import type { DatabaseService } from './database.service.js';
import type {
  MaintenanceRecord,
  MaintenanceRecordDetail,
  MaintenanceRecordPage,
} from '../domain/maintenance.js';
import { DomainError } from '../errors.js';
type Kind = 'taskRuns' | 'restoreReceipts' | 'aiHistory';
const resultCounts = (value: unknown) => {
  const parsed: unknown = JSON.parse(String(value));
  const row = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const count = (key: string) =>
    typeof row[key] === 'number' && Number.isSafeInteger(row[key]) ? row[key] : 0;
  return `导入 ${count('imported')} · 跳过 ${count('skipped')} · 关联 ${count('mapped')}`;
};
export class MaintenanceRecordRepository {
  constructor(private readonly database: DatabaseService) {}
  private spec(kind: Exclude<Kind, 'aiHistory'>) {
    return kind === 'taskRuns'
      ? {
          table: 'task_runs',
          id: 'id',
          time: 'started_at',
          where: 'task_id IN(SELECT id FROM tasks WHERE owner_uid=? OR owner_uid IS NULL)',
          fields: 'id,task_name,status,started_at,finished_at,exit_code',
        }
      : {
          table: 'backup_receipts',
          id: 'request_id',
          time: 'created_at',
          where: 'owner_uid=?',
          fields: 'request_id,created_at,result',
        };
  }
  private decode(
    kind: Exclude<Kind, 'aiHistory'>,
    row: Record<string, unknown>,
  ): MaintenanceRecord {
    return kind === 'taskRuns'
      ? {
          id: String(row.id),
          name: String(row.task_name),
          status: String(row.status),
          createdAt: new Date(Number(row.started_at)).toISOString(),
          summary: row.exit_code === null ? '—' : '退出码 ' + String(row.exit_code),
          bytes: null,
        }
      : {
          id: String(row.request_id),
          name: String(row.request_id),
          status: Number(row.created_at) >= Date.now() - 7 * 86400000 ? 'protected' : 'success',
          createdAt: new Date(Number(row.created_at)).toISOString(),
          summary: resultCounts(row.result),
          bytes: null,
        };
  }
  page(kind: Kind, owner: string, page: number, pageSize: number): MaintenanceRecordPage {
    if (kind === 'aiHistory') {
      const c = this.database.connection;
      return {
        page,
        pageSize,
        total: Number(c.prepare('SELECT count(*) n FROM ai_chats WHERE owner_uid=?').get(owner)?.n),
        items: c
          .prepare(
            'SELECT id,title,connection_name,model,updated_at FROM ai_chats WHERE owner_uid=? ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?',
          )
          .all(owner, pageSize, (page - 1) * pageSize)
          .map((row) => ({
            id: String(row.id),
            name: String(row.title),
            status: 'available',
            createdAt: new Date(Number(row.updated_at)).toISOString(),
            summary: [row.connection_name, row.model].filter(Boolean).join(' · '),
            bytes: null,
          })),
      };
    }
    const d = this.spec(kind),
      c = this.database.connection;
    return {
      page,
      pageSize,
      total: Number(c.prepare(`SELECT count(*) n FROM ${d.table} WHERE ${d.where}`).get(owner)?.n),
      items: c
        .prepare(
          `SELECT ${d.fields} FROM ${d.table} WHERE ${d.where} ORDER BY ${d.time} DESC,${d.id} DESC LIMIT ? OFFSET ?`,
        )
        .all(owner, pageSize, (page - 1) * pageSize)
        .map((row) => this.decode(kind, row)),
    };
  }
  detail(kind: Kind, owner: string, id: string): MaintenanceRecordDetail {
    if (kind === 'aiHistory') {
      const record = this.database.connection
        .prepare(
          'SELECT title,connection_name,model,updated_at FROM ai_chats WHERE owner_uid=? AND id=?',
        )
        .get(owner, id);
      if (!record) throw new DomainError('对话不存在或已清理', 404);
      const rows = this.database.connection
        .prepare(
          'SELECT role,substr(content,1,8192) content,length(content) original_length FROM ai_chat_messages WHERE owner_uid=? AND chat_id=? ORDER BY position LIMIT 101',
        )
        .all(owner, id);
      const bytes = Buffer.from(
        rows
          .slice(0, 100)
          .map(
            (row) =>
              '### ' +
              (row.role === 'user' ? '我' : row.role === 'assistant' ? 'AI' : '提示') +
              '\n\n' +
              String(row.content),
          )
          .join('\n\n'),
      );
      return {
        record: {
          id,
          name: String(record.title),
          status: 'available',
          createdAt: new Date(Number(record.updated_at)).toISOString(),
          summary: [record.connection_name, record.model].filter(Boolean).join(' · '),
          bytes: null,
        },
        text: bytes.subarray(0, 65536).toString('utf8'),
        truncated:
          rows.length > 100 ||
          bytes.length > 65536 ||
          rows.some((row) => Number(row.original_length) > 8192),
        format: 'markdown',
      };
    }
    const d = this.spec(kind);
    const row = this.database.connection
      .prepare(
        `SELECT ${d.fields}${kind === 'taskRuns' ? ',substr(stdout,1,65537) stdout,substr(stderr,1,65537) stderr,truncated' : ''} FROM ${d.table} WHERE ${d.where} AND ${d.id}=?`,
      )
      .get(owner, id);
    if (!row) throw new DomainError('记录不存在或已清理', 404);
    const record = this.decode(kind, row);
    const stdout = Buffer.from(String(row.stdout ?? '')),
      stderr = Buffer.from(String(row.stderr ?? '')),
      outputLimit = 30 * 1024;
    const content =
      kind === 'taskRuns'
        ? `标准输出\n${stdout.subarray(0, outputLimit).toString('utf8') || '（无）'}\n\n错误输出\n${stderr.subarray(0, outputLimit).toString('utf8') || '（无）'}`
        : `请求编号：${record.id}\n处理结果：${record.summary}\n完成时间：${record.createdAt}`;
    const bytes = Buffer.from(content);
    const truncated =
      bytes.length > 65536 ||
      row.truncated === 1 ||
      stdout.length > outputLimit ||
      stderr.length > outputLimit;
    return { record, text: bytes.subarray(0, 65536).toString('utf8'), truncated };
  }
}
