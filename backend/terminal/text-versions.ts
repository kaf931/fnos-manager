import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { TextFileVersion } from '../domain/terminal-files.js';
import type { DatabaseService } from '../persistence/database.service.js';
import {
  TextVersionRepository,
  type VersionRecord,
} from '../persistence/text-version.repository.js';
import { validPath } from './files.js';
import { fail } from './model.js';
import { decodeText } from './text-codec.js';
export interface TextVersionScope {
  owner: string;
  connectionId: string;
  host: string;
  port: number;
  username: string;
  fingerprint: string;
  path: string;
}
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const publicVersion = ({ id, createdAt, size, encoding, bom }: VersionRecord): TextFileVersion => ({
  id,
  createdAt,
  size,
  encoding,
  bom,
});
/** All disk/index operations are synchronous and bounded to 10 MiB per file. A capture cannot remain pending after DB close. */
export class TextVersionService {
  readonly dir: string;
  readonly repository: TextVersionRepository;
  private closed = false;
  constructor(database: DatabaseService) {
    this.repository = new TextVersionRepository(database);
    this.dir = path.join(realpathSync(database.dataDir), 'editor-versions');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { mode: 0o700 });
    this.checkDirectory();
    chmodSync(this.dir, 0o700);
    this.reconcile();
  }
  private checkDirectory() {
    if (this.closed) throw fail('文件版本服务已关闭', 503);
    const stat = lstatSync(this.dir);
    if (!stat.isDirectory() || realpathSync(this.dir) !== this.dir)
      throw fail('文件版本目录无效', 503);
    // Explicit mode check also fails closed under root when filesystem permissions are lost.
    if ((stat.mode & 0o700) !== 0o700 || (stat.mode & 0o077) !== 0)
      throw fail('文件版本目录不可读写', 503);
  }
  private identity(scope: TextVersionScope) {
    if (!scope.owner || !scope.connectionId || !scope.fingerprint)
      throw fail('会话主机身份不可用', 409);
    return hash(
      JSON.stringify([
        scope.host,
        scope.port,
        scope.username,
        scope.fingerprint,
        validPath(scope.path),
      ]),
    );
  }
  private file(id: string) {
    if (!/^[a-f0-9]{48}$/.test(id)) throw fail('文件版本标识无效');
    return path.join(this.dir, id);
  }
  private validateFile(row: VersionRecord, read = false): Buffer | undefined {
    const file = this.file(row.id);
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(descriptor);
      if (
        !stat.isFile() ||
        stat.size !== row.size ||
        (stat.mode & 0o400) === 0 ||
        (stat.mode & 0o077) !== 0
      )
        throw fail('文件版本已损坏或不可读', 503);
      if (!read) return;
      const bytes = readFileSync(descriptor);
      if (hash(bytes) !== row.hash) throw fail('文件版本已损坏', 503);
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  }
  private bytes(row: VersionRecord) {
    return this.validateFile(row, true)!;
  }
  reconcile() {
    this.checkDirectory();
    const rows = this.repository.all();
    const live = new Set<string>();
    for (const row of rows) {
      try {
        this.validateFile(row);
        live.add(row.id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw fail('文件版本存储不可用，请检查目录和历史版本', 503);
        this.repository.remove(row.id);
      }
    }
    for (const id of readdirSync(this.dir)) {
      if (live.has(id)) continue;
      const file = path.join(this.dir, id);
      // Never recurse into directories or follow a symlink supplied as a local filename.
      if (!lstatSync(file).isFile()) throw fail('文件版本目录包含无效条目', 503);
      unlinkSync(file);
    }
  }
  private matching(scope: TextVersionScope) {
    this.checkDirectory();
    const identity = this.identity(scope);
    return this.repository
      .all()
      .filter(
        (row) =>
          row.owner === scope.owner &&
          row.connectionId === scope.connectionId &&
          row.identity === identity,
      );
  }
  list(scope: TextVersionScope): TextFileVersion[] {
    return this.matching(scope).reverse().map(publicVersion);
  }
  private find(scope: TextVersionScope, id: string) {
    const row = this.matching(scope).find((row) => row.id === id);
    if (!row) throw fail('文件版本不存在', 404);
    return row;
  }
  read(scope: TextVersionScope, id: string) {
    const row = this.find(scope, id);
    return { ...decodeText(this.bytes(row), row.encoding), size: row.size, revision: row.hash };
  }
  remove(scope: TextVersionScope, id: string) {
    const row = this.find(scope, id);
    this.checkDirectory();
    // Delete index first: an interrupted cleanup leaves only a harmless orphan, reconciled next time.
    this.repository.remove(row.id);
    try {
      unlinkSync(this.file(row.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  capture(scope: TextVersionScope, data: Buffer, encoding: string) {
    this.reconcile();
    const decoded = decodeText(data, encoding);
    const identity = this.identity(scope),
      contentHash = hash(data);
    const duplicate = this.matching(scope).find(
      (row) =>
        row.hash === contentHash && row.encoding === decoded.encoding && row.bom === decoded.bom,
    );
    if (duplicate) {
      // A retry may reuse a checkpoint only after verifying its actual bytes.
      this.bytes(duplicate);
      return publicVersion(duplicate);
    }
    const row: VersionRecord = {
      id: randomBytes(24).toString('hex'),
      owner: scope.owner,
      connectionId: scope.connectionId,
      identity,
      hash: contentHash,
      createdAt: new Date().toISOString(),
      size: data.length,
      encoding: decoded.encoding,
      bom: decoded.bom,
    };
    const descriptor = openSync(
      this.file(row.id),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(descriptor, data);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const directory = openSync(this.dir, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    try {
      this.repository.database.transaction(() => {
        this.repository.insert(row);
        const rows = this.repository.all();
        const prune = (eligible: VersionRecord[], count: number, bytes: number) => {
          while (
            eligible.length > count ||
            eligible.reduce((sum, item) => sum + item.size, 0) > bytes
          ) {
            const candidate = eligible.findIndex((item) => item.id !== row.id);
            if (candidate < 0) throw fail('文件版本配额不足，未保存远端文件', 507);
            const [oldest] = eligible.splice(candidate, 1);
            this.repository.remove(oldest.id);
            const index = rows.indexOf(oldest);
            if (index >= 0) rows.splice(index, 1);
          }
        };
        prune(
          rows.filter(
            (item) =>
              item.owner === row.owner &&
              item.connectionId === row.connectionId &&
              item.identity === identity,
          ),
          10,
          Infinity,
        );
        prune(
          rows.filter((item) => item.owner === row.owner),
          100,
          100 * 1024 * 1024,
        );
        prune([...rows], 1000, 1024 * 1024 * 1024);
      });
      this.reconcile();
      return publicVersion(row);
    } catch (error) {
      // Keep committed checkpoints on a cleanup failure; no remote write is allowed by the caller.
      if (!this.repository.all().some((item) => item.id === row.id)) unlinkSync(this.file(row.id));
      throw error;
    }
  }
  close() {
    this.closed = true;
  }
}
