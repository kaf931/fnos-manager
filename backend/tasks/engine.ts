import { CONFIG_LIMITS } from '../domain/config-limits.js';
import { randomBytes } from 'node:crypto';
import type { TaskRecord, TaskRun } from '../domain/tasks.js';
import { errorInfo, inputRecord } from '../errors.js';
import { DatabaseService } from '../persistence/database.service.js';
import { TaskRepository } from '../persistence/task.repository.js';
import { nextRun, repeatableTask, validateTask } from './model.js';
interface RunResult {
  code?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
  deviceResults?: unknown[];
}
type Runner = (task: TaskRecord, options: { signal: AbortSignal }) => Promise<RunResult>;
export class TaskEngine {
  readonly repository: TaskRepository;
  private queue: Promise<unknown> = Promise.resolve();
  readonly running = new Map<string, AbortController>();
  private inflight = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    readonly dir: string,
    { runner, database }: { runner: Runner; database?: DatabaseService },
  ) {
    this.repository = new TaskRepository(database ?? new DatabaseService(dir));
    this.runner = runner;
  }
  private readonly runner: Runner;
  get state() {
    return { tasks: this.repository.list(), runs: this.repository.history().items };
  }
  async init() {
    const now = new Date();
    this.repository.transaction(() => {
      for (const run of this.repository.running())
        if (run.status === 'running')
          this.repository.saveRun({
            ...run,
            status: 'interrupted',
            finishedAt: now.toISOString(),
            stderr: '服务重启，任务中断；未自动补跑。',
          });
      this.repository.trimHistory();
      for (const task of this.repository.list())
        if (task.enabled && (!task.nextRunAt || new Date(task.nextRunAt) <= now)) {
          // Interrupted executions are never replayed: their side effects may have happened.
          const interrupted = this.repository.history(task.id, { page: 1, pageSize: 1 }).items[0];
          if (
            task.nextRunAt &&
            task.missedPolicy === 'once' &&
            repeatableTask(task) &&
            interrupted?.status !== 'interrupted'
          )
            continue;
          task.nextRunAt = nextRun(task.schedule, now);
          if (!task.nextRunAt) task.enabled = false;
          this.repository.save(task);
        }
    });
    return this;
  }
  private serial<T>(work: () => T): Promise<T> {
    const result = this.queue.then(() => this.repository.transaction(work));
    this.queue = result.catch(() => {});
    return result;
  }
  list() {
    return this.repository.list().map((task) => ({
      ...task,
      running: this.running.has(task.id),
      lastRun: this.repository.history(task.id, { page: 1, pageSize: 1 }).items[0] ?? null,
    }));
  }
  history(id?: string) {
    return this.repository.history(id).items;
  }
  find(id: string): TaskRecord {
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id))
      throw Object.assign(new Error('任务不存在'), { status: 404 });
    const task = this.repository.find(id);
    if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
    return task;
  }
  async create(input: unknown, now = new Date()) {
    const valid = validateTask(input, now);
    const task = {
      ...valid,
      id: randomBytes(8).toString('hex'),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: valid.enabled ? nextRun(valid.schedule, now) : null,
    } as TaskRecord;
    await this.serial(() => {
      if (this.repository.list().length >= CONFIG_LIMITS.tasks)
        throw new Error('最多可创建 100 个任务');
      this.repository.save(task);
    });
    return task;
  }
  async update(id: string, input: unknown, now = new Date()) {
    const old = this.find(id);
    if (old.pendingReason && inputRecord(input).reviewedAfterRestore !== true)
      throw Object.assign(new Error('任务待完善，请编辑并重新确认后保存'), { status: 409 });
    if (this.running.has(id))
      throw Object.assign(new Error('任务执行中，暂不能修改'), { status: 409 });
    const valid = validateTask(input, now);
    const task = {
      ...valid,
      id,
      createdAt: old.createdAt,
      updatedAt: new Date(Math.max(+now, (Date.parse(old.updatedAt ?? '') || 0) + 1)).toISOString(),
      nextRunAt: valid.enabled ? nextRun(valid.schedule, now) : null,
    } as TaskRecord;
    await this.serial(() => {
      const current = this.find(id),
        expected = inputRecord(input).updatedAt;
      if (
        current.updatedAt !== old.updatedAt ||
        (typeof expected === 'string' && expected !== current.updatedAt)
      )
        throw Object.assign(new Error('任务配置已变化，请刷新列表后重新编辑或切换状态'), {
          status: 409,
        });
      if (this.running.has(id))
        throw Object.assign(new Error('任务执行中，暂不能修改'), { status: 409 });
      this.repository.save(task);
    });
    return task;
  }
  async remove(id: string) {
    this.find(id);
    if (this.running.has(id))
      throw Object.assign(new Error('任务执行中，暂不能删除'), { status: 409 });
    await this.serial(() => {
      this.find(id);
      if (this.running.has(id))
        throw Object.assign(new Error('任务执行中，暂不能删除'), { status: 409 });
      this.repository.remove(id);
    });
  }
  async run(
    id: string,
    { trigger = 'manual', now = new Date() }: { trigger?: 'manual' | 'schedule'; now?: Date } = {},
  ) {
    const task = this.find(id);
    if (task.pendingReason)
      throw Object.assign(new Error('任务待完善：' + task.pendingReason), { status: 409 });
    if (this.running.has(id)) throw Object.assign(new Error('该任务正在执行'), { status: 409 });
    if (this.running.size >= 2)
      throw Object.assign(new Error('已有两个任务执行中，请稍后重试'), { status: 409 });
    const abort = new AbortController();
    this.running.set(id, abort);
    const run: TaskRun = {
      id: randomBytes(8).toString('hex'),
      taskId: id,
      taskName: task.name,
      trigger,
      status: 'running',
      startedAt: now.toISOString(),
      stdout: '',
      stderr: '',
    };
    try {
      await this.serial(() => {
        this.repository.saveRun(run);
        this.repository.trimHistory();
        if (trigger === 'schedule') {
          const current = this.repository.find(id);
          if (current) {
            current.nextRunAt = nextRun(current.schedule, now);
            if (!current.nextRunAt) current.enabled = false;
            this.repository.save(current);
          }
        }
      });
    } catch (error) {
      this.running.delete(id);
      throw error;
    }
    const work = (async () => {
      let result: RunResult;
      let attempts = 0;
      const retries = repeatableTask(task) ? Math.min(2, Math.max(0, task.retryCount ?? 0)) : 0;
      do {
        attempts++;
        try {
          result = await this.runner(task, { signal: abort.signal });
        } catch (error) {
          result = {
            code: -1,
            stderr: error instanceof Error ? errorInfo(error).message : '任务执行失败',
          };
        }
        if (result.code === 0 || result.timedOut || abort.signal.aborted || attempts > retries)
          break;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            abort.signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, 30000);
          abort.signal.addEventListener('abort', done, { once: true });
          if (abort.signal.aborted) done();
        });
      } while (!abort.signal.aborted);
      if (attempts > 1)
        result.stderr = `共执行 ${attempts} 次（重试间隔 30 秒）\n` + (result.stderr || '');
      await this.serial(() => {
        const item = this.repository.history(id).items.find((item) => item.id === run.id);
        if (item)
          this.repository.saveRun({
            ...item,
            status: abort.signal.aborted
              ? 'interrupted'
              : result.timedOut
                ? 'timeout'
                : result.code === 0
                  ? 'success'
                  : 'failed',
            finishedAt: new Date().toISOString(),
            stdout: String(result.stdout || '').slice(0, 65536),
            stderr: String(result.stderr || '').slice(0, 65536),
            code: result.code ?? -1,
            truncated: !!result.truncated,
            ...(result.deviceResults ? { deviceResults: result.deviceResults } : {}),
          });
        this.repository.trimHistory();
      });
    })().finally(() => {
      this.running.delete(id);
      this.inflight.delete(work);
    });
    this.inflight.add(work);
    work.catch(() => console.error('[tasks persistence] 执行结果保存失败'));
    return run;
  }
  async tick(now = new Date()) {
    for (const task of this.repository.list()) {
      if (
        !task.enabled ||
        !!task.pendingReason ||
        !task.nextRunAt ||
        new Date(task.nextRunAt) > now ||
        this.running.has(task.id) ||
        this.running.size >= 2
      )
        continue;
      await this.run(task.id, { trigger: 'schedule', now });
    }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.tick().catch(() => console.error('[scheduler] 调度失败')),
      15000,
    );
    this.timer.unref();
  }
  async idle() {
    await Promise.all([...this.inflight]);
  }
  async close() {
    clearInterval(this.timer);
    for (const controller of this.running.values()) controller.abort();
    await this.idle();
    await this.queue;
  }
}
