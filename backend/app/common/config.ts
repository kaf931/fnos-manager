import path from 'node:path';
import type { AppOptions } from './types.js';
/** Validate trusted startup inputs once, before any provider opens files or sockets. */
export function validateOptions(options: AppOptions): void {
  const fail = (name: string): never => {
    throw new Error(`启动配置无效：${name}`);
  };
  for (const name of ['root', 'dataDir'] as const)
    if (typeof options[name] !== 'string' || !path.isAbsolute(options[name])) fail(name);
  for (const name of ['gateway', 'startScheduler'] as const)
    if (typeof options[name] !== 'boolean') fail(name);
  for (const name of ['version', 'csrfToken'] as const)
    if (typeof options[name] !== 'string' || !options[name] || options[name].length > 256)
      fail(name);
  if (
    options.storageRoots !== undefined &&
    (!Array.isArray(options.storageRoots) ||
      options.storageRoots.some((root) => typeof root !== 'string' || !path.isAbsolute(root)))
  )
    fail('storageRoots');
  const limits = options.storageLimits;
  if (limits !== undefined) {
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) fail('storageLimits');
    for (const [key, value] of Object.entries(limits))
      if (
        !['maxEntries', 'maxHashBytes', 'timeoutMs', 'maxCatalogEntries'].includes(key) ||
        !Number.isSafeInteger(value) ||
        value < 1
      )
        fail(`storageLimits.${key}`);
  }
}
export function listenPort(value: string | undefined): number {
  const port = value === undefined ? 5178 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('启动配置无效：PORT');
  return port;
}
