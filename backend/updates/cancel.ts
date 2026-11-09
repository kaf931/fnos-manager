import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { readJob, writeJob, terminalPhase, type UpdateJob } from './job.js';
interface ProcessControl {
  command(pid: number): Promise<string[]>;
  signal(pid: number, signal: NodeJS.Signals): void;
  pause(): Promise<void>;
}
const control: ProcessControl = {
  async command(pid) {
    try {
      return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  },
  signal: (pid, signal) => {
    process.kill(pid, signal);
  },
  pause: () => new Promise((resolve) => setTimeout(resolve, 50)),
};
const stoppable = (job: UpdateJob) => ['downloading', 'verifying', 'waiting'].includes(job.phase);
/** Workers are detached process-group leaders. Freeze before checking their last
 * durable phase/installation lock so cancellation cannot interrupt replacement.
 * This also safely stops downloads launched by older packaged workers. */
export async function cancelUpdate(
  dataDir: string,
  jobDir: string,
  proc: ProcessControl = control,
): Promise<UpdateJob> {
  const file = path.join(jobDir, 'status.json'),
    job = await readJob(file);
  if (!job) throw new Error('更新任务不存在');
  if (terminalPhase(job.phase)) return job;
  if (!stoppable(job)) throw new Error('已进入安装阶段，不能停止更新');
  if (!Number.isInteger(job.pid) || job.pid <= 1 || job.pid === process.pid)
    throw new Error('更新进程尚未就绪，请稍后重试');
  const expectedWorker = path.join(jobDir, 'helper/worker.js'),
    expectedSpec = path.join(jobDir, 'spec.json');
  const matches = async () => {
    const args = await proc.command(job.pid);
    if (!args.length) return false;
    // The worker launch paths are absolute and supplied solely by UpdateManager.
    return (
      /^node(?:js)?$/.test(path.basename(args[0])) &&
      args[1] === expectedWorker &&
      args[2] === expectedSpec
    );
  };
  if (!(await matches())) throw new Error('更新进程身份不匹配，未停止任何进程');
  let paused = false;
  try {
    proc.signal(-job.pid, 'SIGSTOP');
    paused = true;
    if (!(await matches())) throw new Error('更新进程身份已变化');
    const latest = await readJob(file);
    const installing = await access(path.join(dataDir, 'updates/installing')).then(
      () => true,
      (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      },
    );
    if (!latest || latest.pid !== job.pid || !stoppable(latest) || installing)
      throw new Error('已进入安装阶段，不能停止更新');
    proc.signal(-job.pid, 'SIGTERM');
    proc.signal(-job.pid, 'SIGCONT');
    paused = false;
    for (let i = 0; i < 60; i++) {
      if (!(await proc.command(job.pid)).length) {
        latest.phase = 'cancelled';
        latest.message = '更新已停止，下载缓存已保留';
        await writeJob(file, latest);
        return latest;
      }
      await proc.pause();
    }
    throw new Error('更新进程尚未退出，请稍后重新检查');
  } finally {
    if (paused)
      try {
        proc.signal(-job.pid, 'SIGCONT');
      } catch (error) {
        console.error('[self-update] 无法恢复更新进程', error);
      }
  }
}
