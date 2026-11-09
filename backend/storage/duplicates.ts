import type { OperationService } from '../operations/service.js';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DuplicateAction, DuplicateOutcome, StorageContext } from '../domain/storage.js';
import { record } from '../persistence/records.js';
import { fail } from '../terminal/model.js';
import { openScanRoot } from './access.js';
interface DuplicateItem {
  keep: string;
  path: string;
  size?: number;
}
interface DuplicateInput {
  action?: unknown;
  items?: unknown;
  destination?: unknown;
  confirmed?: unknown;
}
interface DuplicateResult {
  results: DuplicateOutcome[];
}
function parseResult(value: unknown): DuplicateResult {
  const data = record(value);
  if (!Array.isArray(data.results)) throw Error('文件处理结果无效');
  return {
    results: data.results.map((item) => {
      const r = record(item);
      if (
        typeof r.path !== 'string' ||
        typeof r.keep !== 'string' ||
        typeof r.success !== 'boolean' ||
        (r.destination !== undefined &&
          r.destination !== null &&
          typeof r.destination !== 'string') ||
        (r.error !== undefined && typeof r.error !== 'string')
      )
        throw Error('文件处理结果无效');
      return {
        path: r.path,
        keep: r.keep,
        success: r.success,
        ...(r.destination === undefined ? {} : { destination: r.destination as string | null }),
        ...(typeof r.error === 'string' ? { error: r.error } : {}),
      };
    }),
  };
}
export class DuplicateService {
  declare storage: StorageContext;
  declare active: Set<Promise<DuplicateResult>>;
  declare children: Set<ChildProcess>;
  private readonly stopTimers = new Map<ChildProcess, ReturnType<typeof setTimeout>>();
  declare closed: boolean;

  constructor(
    storage: StorageContext,
    private readonly audit?: OperationService,
  ) {
    this.storage = storage;
    this.active = new Set();
    this.children = new Set();
    this.closed = false;
    storage.recordOperations = new Set();
  }
  process(owner: string, id: string, input: DuplicateInput) {
    const task = this.run(owner, id, input);
    this.active.add(task);
    task.finally(() => this.active.delete(task)).catch(() => {});
    return task;
  }
  async run(owner: string, id: string, input: DuplicateInput) {
    if (this.closed) throw fail('服务正在关闭', 503);
    const job = this.storage.get(owner, id),
      { action, items, destination, confirmed } = input || {};
    if (job.mode !== 'duplicates' || !job.result || job.status === 'running')
      throw fail('请先完成重复检查');
    if (
      (action !== 'move' && action !== 'delete') ||
      confirmed !== true ||
      !Array.isArray(items) ||
      !items.length ||
      items.length > 100
    )
      throw fail('请选择并确认处理 1–100 个重复副本');
    if (this.storage.recordOperations.has(id)) throw fail('此扫描已有操作正在执行', 409);
    if (
      [...this.storage.recordOperations].some((key) => this.storage.jobs.get(key)?.owner === owner)
    )
      throw fail('已有文件处理正在执行，请等待完成', 409);
    if (this.storage.recordOperations.size >= 2) throw fail('文件处理任务已满，请稍后重试', 409);
    const validated: DuplicateItem[] = items.map((value) => {
      const item = record(value);
      if (typeof item.keep !== 'string' || typeof item.path !== 'string')
        throw fail('所选副本无效或已经处理，请刷新结果');
      return { keep: item.keep, path: item.path };
    });
    const seen = new Set<string>(),
      kept = new Set(validated.map((i) => i.keep)),
      processed = new Set((job.duplicateActions || []).filter((i) => i.success).map((i) => i.path));
    for (const item of validated) {
      if (
        typeof item?.keep !== 'string' ||
        typeof item?.path !== 'string' ||
        item.keep === item.path ||
        seen.has(item.path) ||
        kept.has(item.path) ||
        processed.has(item.path)
      )
        throw fail('所选副本无效或已经处理，请刷新结果');
      const group = job.result.groups.find(
        (g) => g.paths.includes(item.keep) && g.paths.includes(item.path),
      );
      if (!group) throw fail('所选文件不属于本次重复检查结果');
      item.size = group.size;
      seen.add(item.path);
    }
    this.storage.recordOperations.add(id);
    let root, target;
    let auditId: string | undefined;
    try {
      const rootPath = await this.storage.resolve(job.path);
      root = await openScanRoot(rootPath);
      if (action === 'move') target = await openScanRoot(await this.storage.resolve(destination));
      if (this.closed) throw fail('服务正在关闭', 503);
      auditId = this.audit?.begin(
        owner,
        action === 'move' ? 'storage.duplicates.move' : 'storage.duplicates.delete',
        `${validated.length} 个重复文件`,
      );
      const result = await this.worker(root, target, {
        action,
        items: validated,
        rootPath,
        destination,
      });
      const count = result.results.filter((r) => r.success).length;
      if (auditId)
        this.audit!.finish(
          auditId,
          owner,
          count === validated.length ? 'success' : count ? 'partial' : 'failed',
          `已处理 ${count}/${validated.length} 个文件`,
        );
      auditId = undefined;
      const record = this.storage.jobs.get(id);
      if (record) {
        record.duplicateActions = [
          ...(record.duplicateActions || []),
          ...result.results.map((r): DuplicateAction => ({
            ...r,
            action,
            at: new Date().toISOString(),
          })),
        ].slice(-2000);
        await this.storage
          .persist(record)
          .catch(() => console.error('文件处理结果保存失败，请核实实际文件状态'));
      }
      return result;
    } finally {
      if (auditId) this.audit!.finish(auditId, owner, 'interrupted');
      await root?.close();
      await target?.close();
      this.storage.recordOperations.delete(id);
    }
  }
  worker(
    root: FileHandle,
    target: FileHandle | undefined,
    input: {
      action: 'move' | 'delete';
      items: DuplicateItem[];
      rootPath: string;
      destination: unknown;
    },
  ) {
    return new Promise<DuplicateResult>((resolve, reject) => {
      const child = spawn(
        'python3',
        [fileURLToPath(new URL('./duplicates-worker.py', import.meta.url))],
        {
          stdio: ['pipe', 'pipe', 'pipe', root.fd, ...(target ? [target.fd] : [])],
        },
      );
      this.children.add(child);
      let out = '',
        bytes = 0,
        finished = false;
      const timeout = setTimeout(() => this.stop(child), 120000);
      const done = (error: Error | null, value?: DuplicateResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        clearTimeout(this.stopTimers.get(child));
        this.stopTimers.delete(child);
        this.children.delete(child);
        if (error) reject(error);
        else if (value) resolve(value);
      };
      child.stdout!.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) this.stop(child);
        else out += chunk;
      });
      child.stderr!.on('data', () => {});
      child.on('error', () => done(fail('无法启动文件处理工具')));
      child.on('close', (code) => {
        try {
          const decoded: unknown = JSON.parse(out);
          const message = record(decoded).error;
          const value = typeof message === 'string' ? undefined : parseResult(decoded);
          done(
            typeof message === 'string' || code
              ? fail(typeof message === 'string' ? message : '文件处理已中断，请重新检查目录')
              : null,
            value,
          );
        } catch {
          done(fail('文件处理已中断，请重新检查目录'));
        }
      });
      child.stdin!.on('error', () => {});
      child.stdin!.end(JSON.stringify(input));
    });
  }
  private stop(child: ChildProcess) {
    if (this.stopTimers.has(child) || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    // Allow staged files to roll back, but do not wait forever on blocked filesystem calls.
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref?.();
    this.stopTimers.set(child, timer);
  }
  async close() {
    this.closed = true;
    for (const child of this.children) this.stop(child);
    await Promise.allSettled([...this.active]);
  }
}
