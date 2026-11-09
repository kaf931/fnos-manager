import { OperationRepository } from '../persistence/operation.repository.js';
import { RetentionRepository } from '../persistence/retention.repository.js';
import { OperationService } from '../operations/service.js';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { chmod, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FileFingerprint,
  RenameEntry,
  RenamePlan,
  RenamePreview,
  RenameRecord,
  RenameSummary,
  RenameRules,
  StorageContext,
} from '../domain/storage.js';
import { errorInfo } from '../errors.js';
import { DatabaseService } from '../persistence/database.service.js';
import { record } from '../persistence/records.js';
import { RenameRepository } from '../persistence/rename.repository.js';
import { fail } from '../terminal/model.js';
import { openScanRoot, parseMountPaths } from './access.js';
interface ConfirmInput {
  confirmed?: unknown;
  ids?: unknown;
}
interface PreviewInput {
  names?: unknown;
  rules?: RenameRules;
  path?: unknown;
}
const validName = (n: unknown): n is string =>
    typeof n === 'string' &&
    !!n.trim() &&
    !['.', '..'].includes(n) &&
    Buffer.byteLength(n) <= 255 &&
    !/[\/\\\x00-\x1f\x7f]/.test(n),
  key = (n: string) => n.normalize('NFC').toLocaleLowerCase('en-US');
const fingerprint = (s: BigIntStats) => ({
    dev: String(s.dev),
    ino: String(s.ino),
    size: String(s.size),
    mtime: String(s.mtimeNs),
    ctime: String(s.ctimeNs),
  }),
  same = (a: FileFingerprint, b: FileFingerprint | undefined) =>
    !!b && (Object.keys(a) as (keyof FileFingerprint)[]).every((k) => a[k] === b[k]),
  identity = (s: BigIntStats) => s.dev + ':' + s.ino;
export function renameName(name: string, rules: RenameRules = {}, index: number = 0) {
  for (const k of ['find', 'replace', 'prefix', 'suffix', 'baseName'] as const)
    if (rules[k] !== undefined && (typeof rules[k] !== 'string' || rules[k].length > 120))
      throw fail('改名规则过长或格式不正确');
  if (rules.mode !== undefined && !['rules', 'unified'].includes(rules.mode))
    throw fail('改名方式无效');
  if (rules.mode === 'unified' && (!rules.baseName?.trim() || !validName(rules.baseName)))
    throw fail('请输入有效的基础名称');
  const ext = rules.keepExtension === false ? '' : path.extname(name),
    base = ext ? name.slice(0, -ext.length) : name;
  let next = rules.find ? base.split(rules.find).join(rules.replace ?? '') : base;
  const start = Number(rules.start ?? 1),
    pad = Number(rules.pad ?? 3);
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    start > 999999 ||
    !Number.isInteger(pad) ||
    pad < 1 ||
    pad > 6
  )
    throw fail('序号起始值需为 0–999999，位数需为 1–6');
  next =
    rules.mode === 'unified'
      ? rules.baseName + '_' + String(start + index).padStart(pad, '0') + ext
      : (rules.prefix || '') +
        (rules.number ? String(start + index).padStart(pad, '0') + '_' : '') +
        next +
        (rules.suffix || '') +
        ext;
  if (!validName(next)) throw fail('新名称为空、过长或包含非法字符');
  return next;
}
export class BatchRenameService {
  declare dataDir: string;
  declare dir: string;
  readonly repository: RenameRepository;
  readonly audit: OperationService;
  private readonly database: DatabaseService;
  private readonly persistedIds = new Set<string>();

  declare storage: StorageContext;
  declare now: () => number;
  declare previews: Map<string, RenamePreview>;
  declare locks: Set<string>;
  declare children: Set<ChildProcess>;
  declare active: Set<Promise<unknown>>;
  declare pending: Promise<void>;
  declare records: RenameSummary[];
  declare closed: boolean;

  constructor({
    dataDir,
    storage,
    now = () => Date.now(),
    database,
    operations,
  }: {
    dataDir: string;
    storage: StorageContext;
    now?: () => number;
    database?: DatabaseService;
    operations?: OperationService;
  }) {
    this.dataDir = dataDir;
    this.dir = path.join(dataDir, 'storage');
    const db = database ?? new DatabaseService(dataDir);
    this.database = db;
    this.repository = new RenameRepository(db);
    this.audit = operations ?? new OperationService(new OperationRepository(db));
    this.storage = storage;
    this.now = now;
    this.previews = new Map();
    this.locks = new Set();
    this.children = new Set();
    this.active = new Set();
    this.pending = Promise.resolve();
    this.records = [];
    this.closed = false;
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    try {
      this.records = this.repository.list();
      for (const item of this.records) this.persistedIds.add(item.id);
    } catch (e) {
      if (errorInfo(e).code !== 'ENOENT') throw e;
    }
    for (const r of this.records)
      if (r.status === 'running') {
        r.status = 'interrupted';
        await this.save(r);
      }
    return this;
  }
  async save(item?: RenameSummary) {
    const items = structuredClone(item ? [item] : this.records);
    const job = this.pending.then(() => {
      for (const entry of items) {
        this.repository.save(entry);
        this.persistedIds.add(entry.id);
      }
      this.pruneHistory();
    });
    this.pending = job.catch(() => {});
    return job;
  }
  protectedHistoryIds() {
    return this.records
      .filter((r) => r.status === 'running' || this.locks.has(r.path))
      .map((r) => r.id);
  }
  pruneHistory(owner?: string, clear = false) {
    const retention = new RetentionRepository(this.database);
    const ids =
      clear && owner
        ? retention.clear('renames', owner, this.protectedHistoryIds())
        : retention.trim('renames', retention.limits().renames, this.protectedHistoryIds());
    const removed = new Set(ids);
    for (const id of ids) this.persistedIds.delete(id);
    this.records = this.records.filter((r) => !removed.has(r.id));
    return ids.length;
  }
  public(r: RenameSummary, detail: boolean = true) {
    const { owner, directoryIdentity, entries, ...value } = r;
    return {
      ...value,
      ...(detail
        ? {
            entries: this.hydrate(r).entries.map(({ from, to, applied }) => ({
              from,
              to,
              applied: !!applied,
            })),
          }
        : {}),
    };
  }
  private owned(owner: string, id: string): RenameSummary {
    const item = this.records.find((r) => r.id === id && r.owner === owner);
    if (!item) throw fail('改名记录不存在', 404);
    return item;
  }
  private hasDetails(item: RenameSummary): item is RenameRecord {
    return Array.isArray(item.entries);
  }
  private hydrate(item: RenameSummary): RenameRecord {
    if (this.hasDetails(item)) return item;
    const saved = this.repository.find(item.owner, item.id);
    if (!saved) throw fail('改名记录不存在', 404);
    // Keep one cache object so holders of an existing summary see recovered detail state.
    return Object.assign(item, saved);
  }
  get(owner: string, id: string) {
    return this.public(this.owned(owner, id));
  }
  list(owner: string) {
    return this.records
      .filter((r) => r.owner === owner)
      .reverse()
      .map((r) => this.public(r, false));
  }
  async deleteRecords(owner: string, input: ConfirmInput) {
    const ids = input?.ids;
    if (
      input?.confirmed !== true ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      ids.some((id: unknown) => typeof id !== 'string')
    )
      throw fail('请选择并确认要删除的记录');
    const unique = new Set<string>(ids as string[]),
      items = [...unique].map((id) => {
        return this.owned(owner, id);
      });
    if (items.some((r) => r.status === 'running' || this.locks.has(r.path)))
      throw fail('正在执行的改名记录不能删除', 409);
    for (const item of this.records) if (!this.persistedIds.has(item.id)) await this.save(item);
    const deletion = this.pending.then(() => {
      if (items.some((r) => r.status === 'running' || this.locks.has(r.path)))
        throw fail('正在执行的改名记录不能删除', 409);
      this.repository.remove(owner, [...unique]);
      for (const id of unique) this.persistedIds.delete(id);
      this.records = this.records.filter((r) => !unique.has(r.id));
    });
    this.pending = deletion.catch(() => {});
    await deletion;
    return { deleted: unique.size };
  }
  async folder(target: unknown) {
    const resolved = await this.storage.resolve(target);
    if (process.platform === 'linux') {
      const mounts = parseMountPaths(await readFile('/proc/self/mountinfo', 'utf8'));
      const roots = await this.storage.roots();
      const root = roots.find((r) => resolved === r || resolved.startsWith(r + '/'));
      for (const mount of mounts)
        if (
          root &&
          mount !== root &&
          mount.startsWith(root + '/') &&
          (resolved === mount || resolved.startsWith(mount + '/'))
        )
          throw fail('暂不支持其他挂载目录', 400);
    }
    const handle = await openScanRoot(resolved),
      stat = await handle.stat({ bigint: true });
    return {
      path: resolved,
      handle,
      identity: identity(stat),
      base: process.platform === 'linux' ? '/proc/self/fd/' + handle.fd : resolved,
    };
  }
  async files(target: unknown) {
    const f = await this.folder(target);
    try {
      const names = (await readdir(f.base)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
        items = [];
      let count = 0;
      for (const name of names) {
        if (++count > 2000) break;
        const s = await lstat(path.join(f.base, name), { bigint: true }).catch(() => null);
        if (s?.isFile() || s?.isDirectory())
          items.push({
            name,
            type: s.isDirectory() ? 'directory' : 'file',
            size: Number(s.size),
            modifiedAt: Number(s.mtimeMs),
          });
      }
      items.sort(
        (a, b) =>
          (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) ||
          a.name.localeCompare(b.name, 'zh-CN'),
      );
      const parent = path.dirname(f.path),
        roots = await this.storage.roots();
      return {
        path: f.path,
        parent:
          parent !== f.path && roots.some((r) => parent === r || parent.startsWith(r + '/'))
            ? parent
            : null,
        items: items.slice(0, 1000),
        truncated: count > 2000 || items.length > 1000,
      };
    } finally {
      await f.handle.close();
    }
  }
  prune() {
    for (const [id, p] of this.previews) if (p.expiresAt < this.now()) this.previews.delete(id);
    while (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value!);
  }
  async preview(owner: string, input: PreviewInput) {
    if (this.closed) throw fail('服务正在关闭', 503);
    const { names, rules = {} } = input || {};
    if (
      !Array.isArray(names) ||
      !names.length ||
      names.length > 500 ||
      !names.every(validName) ||
      new Set(names).size !== names.length
    )
      throw fail('请选择 1–500 个不同的普通文件');
    const f = await this.folder(input.path);
    try {
      const existing = new Set((await readdir(f.base)).map(key)),
        targets = new Set<string>(),
        inodes = new Set<string>(),
        entries: RenameEntry[] = [];
      let conflicts = 0;
      for (let i = 0; i < names.length; i++) {
        const from = names[i];
        let to = from,
          error = null,
          before;
        try {
          to = renameName(from, rules, i);
          const stat = await lstat(path.join(f.base, from), { bigint: true });
          if (!stat.isFile()) throw fail('仅支持普通文件，不处理目录或链接');
          before = fingerprint(stat);
          const inode = identity(stat);
          if (inodes.has(inode)) throw fail('同一文件的硬链接请分批处理');
          inodes.add(inode);
          if (to !== from && (existing.has(key(to)) || targets.has(key(to))))
            throw fail('目标名称已存在或批次内重名');
          targets.add(key(to));
        } catch (e) {
          error = errorInfo(e).code === 'ENOENT' ? '文件已不存在' : errorInfo(e).message;
          conflicts++;
        }
        entries.push({ from, to, before, error, unchanged: from === to });
      }
      const p = {
        id: randomBytes(16).toString('hex'),
        owner,
        path: f.path,
        directoryIdentity: f.identity,
        expiresAt: this.now() + 300000,
        entries,
        conflicts,
      };
      this.prune();
      this.previews.set(p.id, p);
      return {
        id: p.id,
        path: p.path,
        expiresAt: p.expiresAt,
        conflicts,
        changed: entries.filter((e) => !e.error && !e.unchanged).length,
        entries: entries.map(({ before, ...e }) => e),
      };
    } finally {
      await f.handle.close();
    }
  }
  async execute(owner: string, id: string, input: ConfirmInput) {
    const p = this.previews.get(id);
    if (!p || p.owner !== owner) throw fail('预览不存在，请重新预览', 404);
    if (input?.confirmed !== true) throw fail('请确认预览后再执行改名');
    if (p.expiresAt < this.now()) throw fail('预览已过期，请重新生成', 409);
    if (p.conflicts) throw fail('请先解决预览中的名称冲突');
    return this.apply(owner, p, 'rename');
  }
  track<T>(work: Promise<T>) {
    this.active.add(work);
    work.then(
      () => this.active.delete(work),
      () => this.active.delete(work),
    );
    return work;
  }
  apply(...args: Parameters<BatchRenameService['_apply']>) {
    return this.track(this._apply(...args));
  }
  async _apply(owner: string, p: RenamePlan, operation: 'rename' | 'undo', undoOf?: string) {
    if (this.closed) throw fail('服务正在关闭', 503);
    if (this.locks.size >= 2 || this.locks.has(p.path)) throw fail('目录正在处理，请稍后重试', 409);
    if (
      [...this.storage.jobs.values()].some(
        (j) =>
          j.status === 'running' &&
          (j.path === p.path || p.path.startsWith(j.path + '/') || j.path.startsWith(p.path + '/')),
      )
    )
      throw fail('此目录正在扫描，请先取消扫描再改名', 409);
    this.locks.add(p.path);
    let auditId: string | undefined;
    let f: Awaited<ReturnType<BatchRenameService['folder']>> | undefined, r: RenameRecord;
    try {
      f = await this.folder(p.path);
      if (this.closed) throw fail('服务正在关闭', 503);
      if (f.identity !== p.directoryIdentity) throw fail('目录已变化，请重新预览', 409);
      const entries = p.entries.filter((e) => !e.unchanged);
      if (!entries.length) throw fail('没有需要改名的文件');
      for (const e of entries) {
        const s = await lstat(path.join(f.base, e.from), {
          bigint: true,
        }).catch(() => null);
        if (!s?.isFile() || !same(fingerprint(s), e.before))
          throw fail('文件已变化，请重新预览', 409);
        const exists = await lstat(path.join(f.base, e.to)).then(
          () => true,
          (e) => {
            if (errorInfo(e).code === 'ENOENT') return false;
            throw e;
          },
        );
        if (exists) throw fail('目标名称已存在，请重新预览', 409);
      }
      r = {
        id: randomBytes(12).toString('hex'),
        owner,
        mode: 'rename',
        operation,
        undoOf,
        path: p.path,
        directoryIdentity: p.directoryIdentity,
        entries: structuredClone(entries),
        status: 'running',
        error: null,
        finishedAt: undefined,
        changed: 0,
        progress: { files: 0, bytes: 0 },
        startedAt: new Date().toISOString(),
      };
      // Commit both registrations together before publishing or consuming the preview.
      // Queue behind journal writes, but never hold a transaction across asynchronous work.
      const registration = this.pending.then(() =>
        this.database.transaction(() => {
          const id = this.audit.begin(
            owner,
            operation === 'undo' ? 'storage.undo' : 'storage.rename',
            `${entries.length} 个文件`,
          );
          this.repository.save(r);
          return id;
        }),
      );
      this.pending = registration.then(
        () => {},
        () => {},
      );
      auditId = await registration;
      this.persistedIds.add(r.id);
      this.records.push(r);
      if (p.id) this.previews.delete(p.id);
      let error;
      try {
        await this.run(f.handle, {
          directoryIdentity: p.directoryIdentity,
          entries,
        });
      } catch (e) {
        error = errorInfo(e).message;
      }
      await this.reconcile(r, f.base);
      r.status = r.changed === entries.length ? 'completed' : r.changed ? 'partial' : 'failed';
      this.audit.finish(
        auditId,
        owner,
        r.status === 'completed' ? 'success' : r.status,
        `已处理 ${r.changed}/${entries.length} 个文件`,
      );
      auditId = undefined;
      r.error = error || null;
      r.finishedAt = new Date().toISOString();
      if (undoOf) {
        const original = this.markReverted(r);
        if (original)
          await this.save(original).catch(() =>
            console.error('撤销结果保存失败，请核实实际文件状态'),
          );
      }
      await this.save(r).catch(() => console.error('改名结果保存失败，请核实实际文件状态'));
      return this.public(r);
    } finally {
      if (auditId) this.audit.finish(auditId, owner, 'interrupted');
      await f?.handle.close();
      this.locks.delete(p.path);
    }
  }
  async reconcile(r: RenameRecord, base: string) {
    for (const e of r.entries) {
      const target = await lstat(path.join(base, e.to), { bigint: true }).catch(() => null),
        source = await lstat(path.join(base, e.from), { bigint: true }).catch(() => null);
      e.applied =
        !!target?.isFile() &&
        !source &&
        (['dev', 'ino', 'size', 'mtime'] as const).every(
          (k) => fingerprint(target!)[k] === e.before?.[k],
        );
      if (e.applied) e.after = fingerprint(target!);
    }
    r.changed = r.entries.filter((e) => e.applied).length;
    r.progress.files = r.changed;
  }
  markReverted(r: RenameRecord) {
    const summary = this.records.find((x) => x.id === r.undoOf && x.owner === r.owner);
    if (!summary) return;
    const original = this.hydrate(summary);
    for (const e of r.entries)
      if (e.applied) {
        const source = original.entries.find((x) => x.from === e.to && x.to === e.from);
        if (source) source.reverted = true;
      }
    if (original.entries.filter((e) => e.applied).every((e) => e.reverted))
      original.undoneBy = r.id;
    return original;
  }
  undo(...args: Parameters<BatchRenameService['_undo']>) {
    return this.track(this._undo(...args));
  }
  async _undo(owner: string, id: string, input: ConfirmInput) {
    if (this.closed) throw fail('服务正在关闭', 503);
    if (input?.confirmed !== true) throw fail('请确认撤销改名');
    const original = this.hydrate(this.owned(owner, id));
    if (original.undoneBy || original.operation !== 'rename') throw fail('此记录不能再次撤销');
    const f = await this.folder(original.path);
    try {
      if (f.identity !== original.directoryIdentity) throw fail('目录已变化，无法撤销');
      if (original.status === 'interrupted') {
        await this.reconcile(original, f.base);
        await this.save(original);
      }
      for (const summary of this.records.filter((r) => r.undoOf === id && r.owner === owner)) {
        const previous = this.hydrate(summary);
        if (previous.status === 'interrupted') await this.reconcile(previous, f.base);
        this.markReverted(previous);
        await this.save(previous);
      }
      await this.save(original);
      const entries = original.entries
        .filter((e) => e.applied && e.after && !e.reverted)
        .map((e) => ({
          from: e.to,
          to: e.from,
          before: e.after,
          unchanged: false,
        }));
      if (!entries.length) throw fail('没有可以撤销的改名');
      return await this.apply(
        owner,
        { path: original.path, directoryIdentity: f.identity, entries },
        'undo',
        id,
      );
    } finally {
      await f.handle.close();
    }
  }
  run(handle: FileHandle, payload: { directoryIdentity: string; entries: RenameEntry[] }) {
    if (this.closed) return Promise.reject(fail('服务正在关闭', 503));
    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        'python3',
        [fileURLToPath(new URL('./rename-worker.py', import.meta.url))],
        { stdio: ['pipe', 'pipe', 'pipe', handle.fd] },
      );
      this.children.add(child);
      let out = '',
        bytes = 0;
      const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
      const finish = (e: Error | null) => {
        clearTimeout(timer);
        this.children.delete(child);
        if (e) reject(e);
        else resolve();
      };
      child.stdout!.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) child.kill('SIGKILL');
        else out += chunk;
      });
      child.stderr!.on('data', () => {});
      child.on('error', () => finish(fail('无法启动改名工具，请确认 NAS 已安装 Python 3')));
      child.on('close', (code) => {
        try {
          const result = record(JSON.parse(out) as unknown);
          finish(
            result.error || code
              ? fail(typeof result.error === 'string' ? result.error : '操作已中断，请查看改名记录')
              : null,
          );
        } catch {
          finish(fail('操作已中断，请查看改名记录'));
        }
      });
      child.stdin!.on('error', () => {});
      child.stdin!.end(JSON.stringify(payload));
    });
  }
  async close() {
    this.closed = true;
    for (const child of this.children) child.kill('SIGTERM');
    await Promise.allSettled([...this.active]);
    await this.pending;
  }
}
