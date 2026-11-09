import {
  constants,
  mkdirSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  linkSync,
  rmSync,
  readdirSync,
  fsyncSync,
  fstatSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { AI_ATTACHMENT_LIMITS } from '../domain/ai-attachments.js';
const validKey = (key: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key);
export class AiAttachmentFiles {
  private readonly directory: string;
  constructor(dataDir: string) {
    let directory = realpathSync(dataDir);
    for (const name of ['ai', 'attachments']) {
      directory = path.join(directory, name);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory)
        throw Error('附件目录不能重定向');
    }
    this.directory = directory;
  }
  private file(key: string): string {
    if (!validKey(key)) throw Error('附件文件标识无效');
    if (!lstatSync(this.directory).isDirectory() || realpathSync(this.directory) !== this.directory)
      throw Error('附件目录不能重定向');
    return path.join(this.directory, key);
  }
  write(key: string, data: Buffer): void {
    const destination = this.file(key),
      temporary = destination + '.tmp-' + randomUUID();
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // Publish without replacing a file that belongs to another attachment.
      linkSync(temporary, destination);
      const dir = openSync(this.directory, constants.O_RDONLY);
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  read(key: string, size: number, hash: string): Buffer {
    const file = this.file(key);
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size !== size || size <= 0 || size > AI_ATTACHMENT_LIMITS.total)
        throw Error('附件文件缺失或大小不符');
      const data = readFileSync(fd);
      if (data.length !== size || createHash('sha256').update(data).digest('hex') !== hash)
        throw Error('附件校验失败');
      return data;
    } finally {
      closeSync(fd);
    }
  }
  remove(key: string): void {
    rmSync(this.file(key), { force: true });
  }
  cleanUnreferenced(referenced: ReadonlySet<string>): { count: number; bytes: number } {
    let count = 0,
      bytes = 0;
    for (const name of readdirSync(this.directory)) {
      if (validKey(name) && !referenced.has(name)) {
        const size = lstatSync(this.file(name)).size;
        this.remove(name);
        count++;
        bytes += size;
      } else if (/^[a-f0-9-]{36}\.tmp-[a-f0-9-]{36}$/.test(name))
        rmSync(path.join(this.directory, name), { force: true });
    }
    return { count, bytes };
  }
}
