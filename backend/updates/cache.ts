import { publicUpdateText } from './routes.js';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { terminalPhase, type UpdateJob } from './job.js';
import type { MaintenanceRecord, MaintenanceRecordDetail } from '../domain/maintenance.js';
import { DomainError } from '../errors.js';
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
function alive(pid: number) {
  if (!(pid > 1)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
async function bytes(file: string): Promise<number> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let total = 0;
  for (const name of await readdir(file)) total += await bytes(path.join(file, name));
  return total;
}
/** Only updater-owned task directories are eligible; never follow links into app data. */
export class UpdateCache {
  constructor(private readonly folder: string) {}
  private async ids() {
    try {
      const info = await lstat(this.folder);
      if (!info.isDirectory() || info.isSymbolicLink()) return [];
      return (await readdir(this.folder, { withFileTypes: true }))
        .filter((entry) => validId(entry.name) && entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  private async job(id: string): Promise<UpdateJob | null> {
    try {
      const file = path.join(this.folder, id, 'status.json');
      if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) return null;
      const job = JSON.parse(await readFile(file, 'utf8')) as UpdateJob;
      return job.id === id && typeof job.phase === 'string' ? job : null;
    } catch {
      return null;
    }
  }
  async records(): Promise<MaintenanceRecord[]> {
    const records: MaintenanceRecord[] = [];
    for (const id of await this.ids()) {
      try {
        const job = await this.job(id);
        records.push({
          id,
          name: job ? `更新 ${job.version}` : '未完成的更新任务',
          status: job && terminalPhase(job.phase) && !alive(job.pid) ? 'available' : 'in-use',
          createdAt:
            job && Number.isFinite(job.updatedAt) ? new Date(job.updatedAt).toISOString() : null,
          summary: publicUpdateText(job?.message || '任务状态不可读，暂不清理'),
          bytes: await bytes(path.join(this.folder, id)),
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    return records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  async detail(id: string): Promise<MaintenanceRecordDetail> {
    const record = (await this.records()).find((row) => row.id === id);
    if (!record) throw new DomainError('更新缓存不存在', 404);
    const file = path.join(this.folder, id, 'update.log');
    let text = record.summary,
      truncated = false;
    try {
      const info = await lstat(file);
      if (info.isFile() && !info.isSymbolicLink()) {
        const { open } = await import('node:fs/promises');
        const handle = await open(file, 'r');
        try {
          const buffer = Buffer.alloc(Math.min(info.size, 65536));
          const result = await handle.read(
            buffer,
            0,
            buffer.length,
            Math.max(0, info.size - buffer.length),
          );
          text += '\n\n' + buffer.subarray(0, result.bytesRead).toString('utf8');
          truncated = info.size > buffer.length;
        } finally {
          await handle.close();
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return { record, text: publicUpdateText(text), truncated };
  }
  async clear(ids?: string[]) {
    let deleted = 0;
    for (const id of await this.ids()) {
      if (ids && !ids.includes(id)) continue;
      const job = await this.job(id);
      if (!job || !terminalPhase(job.phase)) continue;
      // A worker still exiting must retain its state/log files.
      if (alive(job.pid)) continue;
      await rm(path.join(this.folder, id), { recursive: true, force: true });
      deleted++;
      try {
        const current = path.join(this.folder, 'current.json');
        const info = await lstat(current);
        if (!info.isSymbolicLink() && JSON.parse(await readFile(current, 'utf8')).id === id)
          await rm(current, { force: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    return deleted;
  }
}
