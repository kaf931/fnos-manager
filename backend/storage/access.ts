import type { BigIntStats, Stats } from 'node:fs';
import { constants } from 'node:fs';
import { lstat, open, opendir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
const directoryFlags =
    constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0),
  identity = (s: Stats | BigIntStats) => `${s.dev}:${s.ino}`;
export async function createScanAccess(root: string, expected: string) {
  const rootHandle = await openScanRoot(root),
    stat = await rootHandle.stat();
  if (!stat.isDirectory() || identity(stat) !== expected) {
    await rootHandle.close();
    throw Error('扫描目录已变化，请重新选择');
  }
  const linux = process.platform === 'linux';
  const rootMount = linux ? await mountId(rootHandle.fd) : null;
  async function checkRoot() {
    if (!linux && ((await realpath(root)) !== root || identity(await lstat(root)) !== expected))
      throw Error('扫描目录已变化，请重新选择');
  }
  async function directory(target: string) {
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw Error('扫描目录越界');
    let current = rootHandle;
    try {
      await checkRoot();
      let resolved = root;
      for (const part of relative.split(path.sep).filter(Boolean)) {
        resolved = path.join(resolved, part);
        const actual = linux ? `/proc/self/fd/${current.fd}/${part}` : resolved;
        if (!linux && (await realpath(actual)) !== actual) throw Error('目录已变化');
        const next = await open(actual, directoryFlags);
        if (linux && (await mountId(next.fd)) !== rootMount) {
          await next.close();
          throw Error('跳过其他挂载目录');
        }
        if (current !== rootHandle) await current.close();
        current = next;
      }
      await checkRoot();
      return current;
    } catch (e) {
      if (current !== rootHandle) await current.close().catch(() => {});
      throw e;
    }
  }
  async function withParent<T>(target: string, fn: (actual: string) => Promise<T>) {
    const handle = await directory(path.dirname(target));
    try {
      const actual = linux ? `/proc/self/fd/${handle.fd}/${path.basename(target)}` : target;
      return await fn(actual);
    } finally {
      if (handle !== rootHandle) await handle.close().catch(() => {});
    }
  }
  return {
    stat,
    async directory(target: string, expectedDirectory?: string) {
      const handle = await directory(target);
      try {
        if (expectedDirectory && identity(await handle.stat()) !== expectedDirectory)
          throw Error('目录已变化');
        return await opendir(linux ? `/proc/self/fd/${handle.fd}` : target);
      } finally {
        if (handle !== rootHandle) await handle.close().catch(() => {});
      }
    },
    lstat: (target: string) => withParent(target, (p: string) => lstat(p)),
    open: (target: string) =>
      withParent(target, (p: string) => open(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))),
    async close() {
      await rootHandle.close();
    },
  };
}
async function mountId(fd: number) {
  const text = await readFile(`/proc/self/fdinfo/${fd}`, 'utf8'),
    match = text.match(/^mnt_id:\s*(\d+)/m);
  if (!match) throw Error('无法确认目录挂载边界');
  return match[1];
}
export function parseMountPaths(text: string) {
  return new Set<string>(
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line: string) =>
        line
          .split(' ')[4]
          ?.replace(/\\([0-7]{3})/g, (_: string, n: string) => String.fromCharCode(parseInt(n, 8))),
      )
      .filter((value): value is string => !!value),
  );
}

export async function openScanRoot(target: string) {
  if (process.platform !== 'linux') {
    if ((await realpath(target)) !== target) throw Error('请选择实际目录，不支持符号链接');
    return open(target, directoryFlags);
  }
  let current = await open('/', directoryFlags);
  try {
    for (const part of target.split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${current.fd}/${part}`, directoryFlags);
      await current.close();
      current = next;
    }
    return current;
  } catch (e) {
    await current.close().catch(() => {});
    throw e;
  }
}
