import { DomainError } from '../errors.js';
import type { MaintenanceRecord, MaintenanceRecordDetail } from '../domain/maintenance.js';
import {
  constants,
  closeSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
/** Keeps the live inode open: stdout/stderr may still hold an append descriptor. */
export class ServiceLog {
  constructor(private readonly dataDir: string) {}
  private open(name: string, flags: number) {
    try {
      const fd = openSync(path.join(this.dataDir, name), flags | constants.O_NOFOLLOW);
      if (!fstatSync(fd).isFile()) {
        closeSync(fd);
        throw new Error('服务日志不是普通文件');
      }
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  files(): MaintenanceRecord[] {
    const items: MaintenanceRecord[] = [];
    for (const [id, name] of [
      ['current', 'service.log'],
      ['previous', 'service.log.1'],
    ] as const) {
      const fd = this.open(name, constants.O_RDONLY);
      if (fd === null) continue;
      try {
        const stat = fstatSync(fd);
        items.push({
          id,
          name,
          status: 'available',
          createdAt: stat.mtime.toISOString(),
          summary: id === 'current' ? '当前日志' : '上一份日志',
          bytes: stat.size,
        });
      } finally {
        closeSync(fd);
      }
    }
    return items;
  }
  detail(id: string): MaintenanceRecordDetail {
    const name = id === 'current' ? 'service.log' : id === 'previous' ? 'service.log.1' : null;
    if (!name) throw new DomainError('日志不存在', 404);
    const fd = this.open(name, constants.O_RDONLY);
    if (fd === null) throw new DomainError('日志不存在或已轮转', 404);
    try {
      const stat = fstatSync(fd),
        size = Math.min(stat.size, 65536),
        bytes = Buffer.alloc(size);
      let read = 0;
      while (read < size) {
        const n = readSync(fd, bytes, read, size - read, stat.size - size + read);
        if (!n) break;
        read += n;
      }
      let text = bytes.subarray(0, read).toString('utf8');
      if (stat.size > size) {
        const end = text.indexOf('\n');
        if (end >= 0) text = text.slice(end + 1);
      }
      return {
        record: {
          id,
          name,
          status: 'available',
          createdAt: stat.mtime.toISOString(),
          summary: id === 'current' ? '当前日志' : '上一份日志',
          bytes: stat.size,
        },
        text,
        truncated: stat.size > size,
      };
    } finally {
      closeSync(fd);
    }
  }
  summary() {
    let bytes = 0,
      count = 0;
    for (const name of ['service.log', 'service.log.1']) {
      const fd = this.open(name, constants.O_RDONLY);
      if (fd === null) continue;
      try {
        const size = fstatSync(fd).size;
        bytes += size;
        if (size > 0) count++;
      } finally {
        closeSync(fd);
      }
    }
    return { bytes, count };
  }
  rotate(limit: number) {
    const fd = this.open('service.log', constants.O_RDWR);
    if (fd === null) return;
    let temp: string | undefined, out: number | undefined;
    try {
      const size = fstatSync(fd).size;
      if (size <= limit) return;
      temp = path.join(this.dataDir, '.service-log-' + randomBytes(12).toString('hex'));
      out = openSync(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      const buffer = Buffer.alloc(Math.min(65536, limit));
      for (let position = Math.max(0, size - limit); position < size;) {
        const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
        if (!n) break;
        let offset = 0;
        while (offset < n) offset += writeSync(out, buffer, offset, n - offset);
        position += n;
      }
      fsyncSync(out);
      closeSync(out);
      out = undefined;
      renameSync(temp, path.join(this.dataDir, 'service.log.1'));
      temp = undefined;
      ftruncateSync(fd, 0);
    } finally {
      if (out !== undefined) closeSync(out);
      if (temp) unlinkSync(temp);
      closeSync(fd);
    }
    // Lowered quotas must also bound an archive created under a previous larger quota.
    this.trimArchive(limit);
  }
  private trimArchive(limit: number) {
    const fd = this.open('service.log.1', constants.O_RDWR);
    if (fd === null) return;
    try {
      if (fstatSync(fd).size > limit) ftruncateSync(fd, limit);
    } finally {
      closeSync(fd);
    }
  }
  enforce(limit: number) {
    this.rotate(limit);
    this.trimArchive(limit);
  }
  clearSelected(ids: string[]) {
    if (ids.some((id) => id !== 'current' && id !== 'previous'))
      throw new DomainError('日志不存在', 404);
    const handles: { id: string; fd: number }[] = [];
    try {
      for (const id of ids) {
        const fd = this.open(
          id === 'current' ? 'service.log' : 'service.log.1',
          id === 'current' ? constants.O_RDWR : constants.O_RDONLY,
        );
        if (fd === null) throw new DomainError('日志不存在或已轮转，请刷新后重试', 409);
        handles.push({ id, fd });
      }
      for (const { id, fd } of handles)
        if (id === 'current') ftruncateSync(fd, 0);
        else unlinkSync(path.join(this.dataDir, 'service.log.1'));
      return handles.length;
    } finally {
      for (const { fd } of handles) closeSync(fd);
    }
  }
  clear() {
    const before = this.summary();
    const fd = this.open('service.log', constants.O_RDWR);
    if (fd !== null)
      try {
        ftruncateSync(fd, 0);
      } finally {
        closeSync(fd);
      }
    const archive = this.open('service.log.1', constants.O_RDONLY);
    if (archive !== null) {
      closeSync(archive);
      unlinkSync(path.join(this.dataDir, 'service.log.1'));
    }
    return before.count;
  }
}
