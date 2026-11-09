import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import type {
  DuplicateGroup,
  ScanEntry,
  ScanExtension,
  ScanFile,
  ScanLimits,
} from '../domain/storage.js';
import { errorInfo } from '../errors.js';
import { record } from '../persistence/records.js';
import { createScanAccess, parseMountPaths } from './access.js';
const data = record(workerData as unknown);
if (
  typeof data.path !== 'string' ||
  typeof data.identity !== 'string' ||
  (data.mode !== 'space' && data.mode !== 'duplicates')
)
  throw Error('扫描参数无效');
const root = data.path,
  mode = data.mode,
  rootIdentity = data.identity;
const rawLimits = data.limits === undefined ? {} : record(data.limits);
const limits: ScanLimits = {};
for (const key of ['maxEntries', 'maxHashBytes', 'timeoutMs', 'maxCatalogEntries'] as const) {
  const value = rawLimits[key];
  if (value !== undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw Error('扫描限制无效');
    limits[key] = value;
  }
}
const maxEntries = limits.maxEntries ?? 100000,
  maxHashBytes = limits.maxHashBytes ?? 20 * 1024 ** 3,
  deadline = Date.now() + (limits.timeoutMs ?? 600000);
const progress = { files: 0, directories: 0, bytes: 0, hashedBytes: 0 },
  totals = new Map<string, ScanEntry>(),
  extensions = new Map<string, ScanExtension>(),
  files: { path: string; size: number; snapshot: string }[] = [],
  catalog: ScanFile[] = [],
  largestFiles: ScanFile[] = [],
  seen = new Set<string>();
let access;
let skippedLinks = 0,
  skippedHardLinks = 0,
  skippedMounts = 0,
  errors = 0,
  count = 0,
  limited = false,
  reason = '',
  last = 0,
  catalogBytes = 0;
const guard = () => {
  if (Date.now() > deadline) throw Error('扫描达到 10 分钟运行上限，请缩小范围');
};
const publish = () => {
  if (Date.now() - last > 250) {
    last = Date.now();
    parentPort!.postMessage({ type: 'progress', value: progress });
  }
};
const snapshot = (s: Stats) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
try {
  access = await createScanAccess(root, rootIdentity);
  const base = access.stat,
    mounts =
      process.platform === 'linux'
        ? parseMountPaths(await readFile('/proc/self/mountinfo', 'utf8'))
        : new Set<string>(),
    visitedDirectories = new Set<string>();
  const stack = [{ dir: root, depth: 0, identity: base.dev + ':' + base.ino }];
  while (stack.length) {
    guard();
    const { dir, depth, identity } = stack.pop()!;
    if (visitedDirectories.has(identity)) continue;
    visitedDirectories.add(identity);
    let handle;
    try {
      handle = await access.directory(dir, identity);
    } catch {
      errors++;
      continue;
    }
    try {
      for await (const entry of handle) {
        guard();
        if (++count > maxEntries) throw Error('扫描达到条目数量上限，请缩小范围');
        const name = path.join(dir, entry.name),
          rel = path.relative(root, name),
          top = rel.split(path.sep)[0];
        if (mounts.has(name)) {
          skippedMounts++;
          continue;
        }
        let st;
        try {
          st = await access.lstat(name);
        } catch {
          errors++;
          continue;
        }
        if (st.isSymbolicLink()) {
          skippedLinks++;
          continue;
        }
        if (st.dev !== base.dev) {
          skippedMounts++;
          continue;
        }
        if (!totals.has(top))
          totals.set(top, {
            name: top,
            path: path.join(root, top),
            type: st.isDirectory() ? 'directory' : 'file',
            bytes: 0,
            files: 0,
          });
        if (st.isDirectory()) {
          progress.directories++;
          if (depth >= 64) {
            limited = true;
            reason = '部分目录超过 64 层深度上限';
            continue;
          }
          stack.push({
            dir: name,
            depth: depth + 1,
            identity: st.dev + ':' + st.ino,
          });
        } else if (st.isFile()) {
          const key = st.dev + ':' + st.ino;
          if (seen.has(key)) {
            skippedHardLinks++;
            continue;
          }
          seen.add(key);
          const item = {
            path: name,
            name: entry.name,
            type: 'file',
            size: st.size,
            bytes: st.size,
            modifiedAt: st.mtimeMs,
            extension: path.extname(name).toLowerCase() || '无扩展名',
          };
          const itemBytes = Buffer.byteLength(JSON.stringify(item));
          if (
            catalog.length < Math.min(10000, limits.maxCatalogEntries ?? 10000) &&
            catalogBytes + itemBytes <= 2 * 1024 * 1024
          ) {
            catalog.push(item);
            catalogBytes += itemBytes;
          }
          largestFiles.push(item);
          if (largestFiles.length > 2000) {
            largestFiles.sort((a, b) => b.size - a.size);
            largestFiles.length = 1000;
          }
          progress.files++;
          progress.bytes += st.size;
          const group = totals.get(top)!;
          group.bytes += st.size;
          group.files++;
          const extension = path.extname(name).toLowerCase() || '无扩展名',
            ext = extensions.get(extension) || {
              name: extension,
              bytes: 0,
              files: 0,
            };
          ext.bytes += st.size;
          ext.files++;
          extensions.set(extension, ext);
          if (mode === 'duplicates' && st.size > 0)
            files.push({ path: name, size: st.size, snapshot: snapshot(st) });
        }
        publish();
      }
    } catch (e) {
      if (/上限/.test(errorInfo(e).message)) throw e;
      errors++;
    }
  }
  let groups: DuplicateGroup[] = [];
  if (mode === 'duplicates') {
    const candidates = new Map<number, { path: string; size: number; snapshot: string }[]>();
    for (const f of files) {
      const group = candidates.get(f.size) || [];
      group.push(f);
      candidates.set(f.size, group);
    }
    const hashes = new Map<string, DuplicateGroup>();
    for (const group of candidates.values()) {
      if (group.length < 2) continue;
      for (const file of group) {
        guard();
        if (progress.hashedBytes + file.size > maxHashBytes)
          throw Error('扫描达到 20 GiB 内容读取上限，请缩小范围');
        let handle;
        try {
          handle = await access.open(file.path);
          const before = await handle.stat();
          if (!before.isFile() || snapshot(before) !== file.snapshot) {
            errors++;
            continue;
          }
          const hash = createHash('sha256'),
            buffer = Buffer.allocUnsafe(256 * 1024);
          let offset = 0;
          while (offset < file.size) {
            guard();
            const { bytesRead } = await handle.read(
              buffer,
              0,
              Math.min(buffer.length, file.size - offset),
              offset,
            );
            if (!bytesRead) throw Error('文件扫描期间变化');
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
            progress.hashedBytes += bytesRead;
            publish();
          }
          if (snapshot(await handle.stat()) !== file.snapshot) {
            errors++;
            continue;
          }
          const key = file.size + ':' + hash.digest('hex'),
            matched = hashes.get(key) || { size: file.size, paths: [] };
          matched.paths.push(file.path);
          hashes.set(key, matched);
        } catch (e) {
          if (/上限/.test(errorInfo(e).message)) throw e;
          errors++;
        } finally {
          await handle?.close().catch(() => {});
        }
      }
    }
    groups = [...hashes.values()]
      .filter((g) => g.paths.length > 1)
      .sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1));
  }
  let displayedPaths = 0,
    pathsTruncated = false;
  const boundedGroups = [];
  for (const group of groups.slice(0, 1000)) {
    if (displayedPaths >= 2000) {
      pathsTruncated = true;
      break;
    }
    const paths = group.paths.slice(0, Math.min(200, 2000 - displayedPaths));
    displayedPaths += paths.length;
    if (paths.length < group.paths.length) pathsTruncated = true;
    boundedGroups.push({
      ...group,
      count: group.paths.length,
      paths,
      pathsTruncated: paths.length < group.paths.length,
    });
  }
  const reclaimable = groups.reduce((n, g) => n + g.size * (g.paths.length - 1), 0);
  parentPort!.postMessage({
    type: 'result',
    limited,
    error: reason || null,
    progress,
    value: {
      ...progress,
      skippedLinks,
      skippedHardLinks,
      skippedMounts,
      errors,
      catalog,
      catalogTruncated: progress.files > catalog.length,
      largestFiles: largestFiles.sort((a, b) => b.size - a.size).slice(0, 1000),
      entries: [...totals.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 2000),
      extensions: [...extensions.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 100),
      groups: boundedGroups,
      groupCount: groups.length,
      reclaimable,
      truncated: totals.size > 2000 || groups.length > 1000 || pathsTruncated,
    },
  });
} catch (e) {
  parentPort!.postMessage({
    type: 'result',
    limited: true,
    error: errorInfo(e).message,
    progress,
    value: null,
  });
} finally {
  await access?.close().catch(() => {});
}
