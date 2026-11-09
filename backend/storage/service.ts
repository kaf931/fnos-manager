import { RetentionRepository } from '../persistence/retention.repository.js';
import { decodeScanProgress, decodeScanResult } from './messages.js';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ScanJob, ScanLimits } from '../domain/storage.js';
import { errorInfo } from '../errors.js';
import { DatabaseService } from '../persistence/database.service.js';
import { record } from '../persistence/records.js';
import { ScanRepository } from '../persistence/scan.repository.js';
import { fail } from '../terminal/model.js';
import { openScanRoot } from './access.js';
export const isPhysicalVolume = (name: string) => /^vol[1-9]\d*$/.test(name);
const inside = (root: string, target: string) =>
  target === root || target.startsWith(root + path.sep);
export class StorageService {
  renameService?: import('./rename.js').BatchRenameService;
  readonly dataDir?: string;
  readonly configuredRoots?: string[];
  readonly limits: ScanLimits;
  readonly jobs = new Map<string, ScanJob>();
  closed = false;
  readonly repository?: ScanRepository;
  private persisted = new Map<string, string>();
  pending: Promise<void> = Promise.resolve();
  readonly starting = new Set<Promise<unknown>>();
  recordOperations = new Set<string>();
  private finalizing = new Set<string>();
  private finalizations = new Set<Promise<void>>();

  constructor({
    roots,
    limits = {},
    dataDir,
    database,
  }: { roots?: string[]; limits?: ScanLimits; dataDir?: string; database?: DatabaseService } = {}) {
    this.dataDir = dataDir;
    this.configuredRoots = roots;
    this.limits = limits;
    this.repository = dataDir
      ? new ScanRepository(database ?? new DatabaseService(dataDir))
      : undefined;
  }
  async init() {
    if (!this.repository) return this;
    await mkdir(path.join(this.dataDir!, 'storage'), {
      recursive: true,
      mode: 0o700,
    });
    await chmod(path.join(this.dataDir!, 'storage'), 0o700);
    try {
      const data = { items: this.repository.list() };
      for (const item of data.items) {
        if (
          typeof item.id !== 'string' ||
          typeof item.owner !== 'string' ||
          !['space', 'duplicates'].includes(item.mode)
        )
          continue;
        if (item.status !== 'running') this.persisted.set(item.id, JSON.stringify(item));
        if (item.status === 'running') {
          item.status = 'interrupted';
          item.error = '服务重启，扫描已中断，请重新扫描';
          item.finishedAt = new Date().toISOString();
        }
        this.jobs.set(item.id, item);
      }
    } catch (e) {
      if (errorInfo(e).code !== 'ENOENT') throw e;
    }
    await this.persist();
    return this;
  }
  async persist(job?: ScanJob) {
    if (!this.repository) return;
    const records = (job ? [job] : [...this.jobs.values()]).map(({ worker, ...item }) => ({
      id: item.id,
      running: item.status === 'running' || this.recordOperations?.has(item.id),
      text: JSON.stringify(item),
    }));
    const task = this.pending.then(async () => {
      for (const entry of records) {
        if (!this.jobs.has(entry.id)) continue;
        if (this.persisted.get(entry.id) === entry.text) continue;
        await this.repository!.save(JSON.parse(entry.text));
        this.persisted.set(entry.id, entry.text);
      }
      this.pruneHistory();
    });
    this.pending = task.catch(() => {});
    return task;
  }
  protectedHistoryIds() {
    return [...this.jobs.values()]
      .filter(
        (j) =>
          j.status === 'running' || this.recordOperations.has(j.id) || this.finalizing.has(j.id),
      )
      .map((j) => j.id);
  }
  pruneHistory(owner?: string, clear = false) {
    if (!this.repository) return 0;
    const retention = new RetentionRepository(this.repository.database);
    const protectedIds = this.protectedHistoryIds();
    const ids =
      clear && owner
        ? retention.clear('scans', owner, protectedIds)
        : retention.trim('scans', retention.limits().scans, protectedIds);
    for (const id of ids) {
      this.jobs.delete(id);
      this.persisted.delete(id);
    }
    return ids.length;
  }
  saveLater(job: ScanJob) {
    this.persist(job).catch(() => {
      if (job) job.persistenceError = '扫描记录未能保存到磁盘';
    });
  }
  async deleteRecords(owner: string, value: unknown) {
    const input = record(value),
      ids = input.ids;
    if (
      input?.confirmed !== true ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      ids.some((id) => typeof id !== 'string')
    )
      throw fail('请选择并确认要删除的记录');
    const unique = [...new Set(ids as string[])],
      items = unique.map((id) => {
        this.get(owner, id);
        return this.jobs.get(id)!;
      });
    if (items.some((j) => j.status === 'running' || this.recordOperations?.has(j.id)))
      throw fail('扫描中的记录不能删除', 409);
    // Persist outstanding results before deleting; publish the in-memory change only after commit.
    await this.persist();
    const deletion = this.pending.then(() => {
      if (items.some((j) => j.status === 'running' || this.recordOperations.has(j.id)))
        throw fail('扫描中的记录不能删除', 409);
      this.repository?.remove(owner, unique);
      for (const id of unique) {
        this.jobs.delete(id);
        this.persisted.delete(id);
      }
    });
    this.pending = deletion.catch(() => {});
    await deletion;
    return { deleted: unique.length };
  }
  async roots() {
    if (this.configuredRoots) return this.configuredRoots;
    return (await readdir('/', { withFileTypes: true }))
      .filter((e) => e.isDirectory() && isPhysicalVolume(e.name))
      .map((e) => '/' + e.name);
  }
  async resolve(target: unknown) {
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0'))
      throw fail('请选择有效的存储目录');
    const normalized = path.resolve(target),
      roots = await this.roots(),
      actual = await realpath(normalized);
    if (!roots.some((r) => inside(path.resolve(r), actual)))
      throw fail('请选择本地存储空间中的实际目录；暂不支持远程挂载', 403);
    const routingAlias = !this.configuredRoots && /^\/vol0[12](?:\/|$)/.test(normalized);
    if ((actual !== normalized && !routingAlias) || !(await lstat(actual)).isDirectory())
      throw fail('请选择实际目录，不支持符号链接');
    return actual;
  }
  async browse(target: unknown) {
    if (!target)
      return {
        path: null,
        parent: null,
        items: (await this.roots()).map((p) => ({
          name: '存储空间 ' + path.basename(p).replace(/^vol/, '') + ' (' + p + ')',
          path: p,
        })),
        truncated: false,
      };
    const base = await this.resolve(target),
      roots = await this.roots();
    const handle = await openScanRoot(base);
    let entries;
    try {
      entries = await readdir(process.platform === 'linux' ? '/proc/self/fd/' + handle.fd : base, {
        withFileTypes: true,
      });
    } finally {
      await handle.close();
    }
    const items = entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return {
      path: base,
      parent: roots.includes(base) ? null : path.dirname(base),
      items: items.slice(0, 1000).map((e) => ({ name: e.name, path: path.join(base, e.name) })),
      truncated: items.length > 1000,
    };
  }
  get(owner: string, id: string) {
    const j = this.jobs.get(id)!;
    if (!j || j.owner !== owner) throw fail('扫描记录不存在', 404);
    if (j.result === undefined && this.repository) {
      const saved = this.repository.find(owner, id);
      if (saved) j.result = saved.result;
    }
    const { worker, owner: uid, ...result } = j;
    return structuredClone(result);
  }
  list(owner: string) {
    return [...this.jobs.values()]
      .filter((j) => j.owner === owner)
      .reverse()
      .map((j) => {
        const { worker, owner: uid, result, ...rest } = j;
        return structuredClone(rest);
      });
  }
  start(...args: Parameters<StorageService['_start']>) {
    const work = this._start(...args);
    this.starting.add(work);
    work.then(
      () => this.starting.delete(work),
      () => this.starting.delete(work),
    );
    return work;
  }
  async _start(owner: string, value: unknown) {
    const input = record(value);
    if (this.closed) throw fail('服务正在关闭', 503);
    if (!['space', 'duplicates'].includes(String(input.mode))) throw fail('请选择扫描类型');
    const target = await this.resolve(input.path),
      rootStat = await lstat(target);
    if (!rootStat.isDirectory()) throw fail('扫描目录已变化');
    if (this.closed) throw fail('服务正在关闭', 503);
    if ([...this.jobs.values()].some((j) => j.owner === owner && j.status === 'running'))
      throw fail('已有扫描正在运行，请先取消或等待完成', 409);
    if ([...this.jobs.values()].filter((j) => j.status === 'running').length >= 2)
      throw fail('扫描任务已满，请稍后重试', 409);
    const j: ScanJob = {
      id: randomBytes(12).toString('hex'),
      owner,
      path: target,
      mode: input.mode as ScanJob['mode'],
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: { files: 0, directories: 0, bytes: 0, hashedBytes: 0 },
      result: null,
      error: null,
    };
    this.jobs.set(j.id, j);
    try {
      const volume = (await this.roots()).find((r) => inside(r, target)),
        fs = await statfs(target);
      j.capacity = {
        volumePath: volume || target,
        scopePath: target,
        total: fs.blocks * fs.bsize,
        available: fs.bavail * fs.bsize,
        used: (fs.blocks - fs.bfree) * fs.bsize,
      };
    } catch {
      j.capacity = null;
    }
    try {
      await this.persist(j);
    } catch (e) {
      this.jobs.delete(j.id);
      throw fail('无法保存扫描记录，请检查应用数据目录');
    }
    if (this.closed) {
      j.status = 'interrupted';
      j.error = '服务正在关闭';
      await this.persist(j);
      throw fail('服务正在关闭', 503);
    }
    if (j.status !== 'running') return this.get(owner, j.id);
    const worker = (j.worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: {
        path: target,
        identity: rootStat.dev + ':' + rootStat.ino,
        mode: input.mode as ScanJob['mode'],
        limits: this.limits,
      },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    }));
    const finish = (status: string, error?: string) => {
      if (j.status !== 'running' || this.finalizing.has(j.id)) return;
      this.finalizing.add(j.id);
      delete j.worker;
      const finishedAt = new Date().toISOString();
      const candidate = { ...j, status, error: error || null, finishedAt };
      const saving = (async () => {
        try {
          await this.persist(candidate);
          if (j.status === 'running')
            Object.assign(j, { status, error: error || null, finishedAt });
        } catch {
          if (j.status === 'running')
            Object.assign(j, {
              status: 'failed',
              error: '扫描结果未能保存，请检查应用数据目录',
              finishedAt,
              persistenceError: '扫描记录未能保存到磁盘',
            });
        } finally {
          this.finalizing.delete(j.id);
        }
      })();
      this.finalizations.add(saving);
      saving.finally(() => this.finalizations.delete(saving)).catch(() => {});
    };
    const timeout = setTimeout(() => {
      if (j.status === 'running' && !this.finalizing.has(j.id)) {
        void worker.terminate();
        finish('limited', '扫描达到运行时间上限，请缩小范围');
      }
    }, this.limits.timeoutMs ?? 600000);
    timeout.unref?.();
    worker.on('message', (value: unknown) => {
      if (j.status !== 'running' || this.finalizing.has(j.id)) return;
      try {
        const message = record(value);
        if (message.type === 'progress') j.progress = decodeScanProgress(message.value);
        else if (message.type === 'result') {
          j.result = message.value === null ? null : decodeScanResult(message.value);
          j.progress = decodeScanProgress(message.progress);
          finish(
            message.limited ? 'limited' : 'completed',
            typeof message.error === 'string' ? message.error : undefined,
          );
        } else if (message.type === 'error')
          finish('failed', typeof message.error === 'string' ? message.error : undefined);
        else throw new Error('未知扫描消息');
      } catch {
        void worker.terminate();
        finish('failed', '扫描进程返回了无效数据');
      }
    });
    worker.on('error', () => finish('failed', '扫描进程异常结束，请缩小目录范围后重试'));
    worker.on('exit', (code: number) => {
      clearTimeout(timeout);
      if (j.status === 'running')
        finish('failed', code ? '扫描超过内存或运行限制' : '扫描提前结束');
    });
    return this.get(owner, j.id);
  }
  cancel(owner: string, id: string) {
    this.get(owner, id);
    const j = this.jobs.get(id)!;
    if (j.status === 'running') {
      j.status = 'cancelled';
      j.finishedAt = new Date().toISOString();
      j.worker?.terminate();
      delete j.worker;
      this.saveLater(j);
    }
    return this.get(owner, id);
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.starting]);
    const running = [...this.jobs.values()].filter((j) => j.worker);
    for (const j of running) {
      j.status = 'interrupted';
      j.error = '服务停止，扫描已中断';
      j.finishedAt = new Date().toISOString();
    }
    await Promise.all(running.map((j) => j.worker?.terminate()));
    for (const j of running) delete j.worker;
    await Promise.allSettled([...this.finalizations]);
    await this.persist();
    await this.pending;
  }
}
