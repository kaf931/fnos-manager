import { randomUUID } from 'node:crypto';
import type { TransferInput, TransferRecord } from '../domain/transfers.js';
import { fail } from './model.js';
type FinalStatus = 'completed' | 'failed' | 'cancelled' | 'interrupted';
interface Job {
  item: TransferRecord;
  resolve: () => void;
  reject: (error: Error) => void;
  cancel: () => void;
}
interface SessionTransfers {
  owner: string;
  items: TransferRecord[];
  jobs: Map<string, Job>;
}
/** Queue and records are discarded when their live SSH session ends. No byte resume. */
export class TransferService {
  private readonly sessions = new Map<string, SessionTransfers>();
  private advance(session: SessionTransfers) {
    if (session.items.some((item) => item.status === 'running')) return;
    const next = [...session.jobs.values()].find((job) => job.item.status === 'queued');
    if (!next) return;
    next.item.status = 'running';
    next.item.startedAt = Date.now();
    next.resolve();
  }
  begin(input: TransferInput, cancel: () => void = () => {}) {
    let session = this.sessions.get(input.sessionId);
    if (!session) {
      session = { owner: input.owner, items: [], jobs: new Map() };
      this.sessions.set(input.sessionId, session);
    }
    if (session.owner !== input.owner) throw fail('传输会话所属账号不匹配', 403);
    if (session.jobs.size >= 100) throw fail('当前会话传输队列已满，请稍后重试', 409);
    const records = session;
    const item: TransferRecord = {
      id: randomUUID(),
      clientId: input.clientId,
      connectionName: input.connectionName,
      direction: input.direction,
      path: input.path,
      size: input.size,
      transferred: 0,
      status: 'queued',
      queuedAt: Date.now(),
      startedAt: 0,
      finishedAt: null,
    };
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((r, j) => {
      resolve = r;
      reject = j;
    });
    // A request can disconnect before its controller reaches await ready.
    void ready.catch(() => {});
    const finish = (status: FinalStatus) => {
      if (!['queued', 'running'].includes(item.status)) return;
      const queued = item.status === 'queued';
      item.status = status;
      item.finishedAt = Date.now();
      if (status === 'completed') item.transferred = item.size;
      if (queued) reject(fail('传输已取消', 409));
      records.jobs.delete(item.id);
      let completed = 0;
      records.items = records.items.filter(
        (entry) => ['queued', 'running'].includes(entry.status) || ++completed <= 100,
      );
      this.advance(records);
    };
    records.items.unshift(item);
    records.jobs.set(item.id, {
      item,
      resolve,
      reject,
      cancel: () => {
        // Abort first; advancing happens only after active stream cleanup in finally.
        cancel();
        if (item.status === 'queued') finish('cancelled');
      },
    });
    this.advance(records);
    return {
      ready,
      cancel: () => records.jobs.get(item.id)?.cancel(),
      progress: (bytes: number, size?: number) => {
        if (item.status !== 'running') return;
        item.transferred = bytes;
        if (size !== undefined) item.size = size;
      },
      finish,
    };
  }
  cancel(owner: string, sessionId: string, id: string) {
    const session = this.sessions.get(sessionId);
    const job = session?.owner === owner ? session.jobs.get(id) : undefined;
    if (!job) throw fail('传输不存在或已结束', 404);
    job.cancel();
  }
  list(owner: string, sessionId: string, summary = false) {
    const session = this.sessions.get(sessionId);
    const items = session?.owner === owner ? session.items : [];
    return {
      active: items.filter((item) => ['queued', 'running'].includes(item.status)).length,
      items: summary ? [] : items,
    };
  }
  clearSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    // Stop all pending operations without starting another queued operation.
    const jobs = [...session.jobs.values()];
    session.jobs.clear();
    for (const job of jobs) {
      const queued = job.item.status === 'queued';
      job.item.status = 'interrupted';
      job.cancel();
      if (queued) job.reject(fail('SSH 会话已结束', 409));
    }
  }
}
