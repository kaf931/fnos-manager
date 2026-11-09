import type {
  ScanProgress,
  ScanResult,
  ScanFile,
  ScanEntry,
  ScanExtension,
  DuplicateGroup,
} from '../domain/storage.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const strings = (row: ObjectValue, keys: string[]) =>
  keys.every((key) => typeof row[key] === 'string');
const counts = (row: ObjectValue, keys: string[]) => keys.every((key) => count(row[key]));
const arrayOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.every(guard);
const progress = (value: unknown): value is ScanProgress =>
  object(value) && counts(value, ['files', 'directories', 'bytes', 'hashedBytes']);
const file = (value: unknown): value is ScanFile =>
  object(value) &&
  strings(value, ['path', 'name', 'type', 'extension']) &&
  counts(value, ['size', 'bytes']) &&
  typeof value.modifiedAt === 'number' &&
  Number.isFinite(value.modifiedAt);
const entry = (value: unknown): value is ScanEntry =>
  object(value) && strings(value, ['name', 'path', 'type']) && counts(value, ['bytes', 'files']);
const extension = (value: unknown): value is ScanExtension =>
  object(value) && strings(value, ['name']) && counts(value, ['bytes', 'files']);
const group = (value: unknown): value is DuplicateGroup =>
  object(value) &&
  count(value.size) &&
  arrayOf(value.paths, (item): item is string => typeof item === 'string') &&
  (value.count === undefined || count(value.count)) &&
  (value.pathsTruncated === undefined || typeof value.pathsTruncated === 'boolean');
function result(value: unknown): value is ScanResult {
  return (
    object(value) &&
    progress(value) &&
    counts(value, ['skippedLinks', 'skippedMounts', 'errors', 'groupCount', 'reclaimable']) &&
    ['catalogTruncated', 'truncated'].every((key) => typeof value[key] === 'boolean') &&
    arrayOf(value.catalog, file) &&
    arrayOf(value.largestFiles, file) &&
    arrayOf(value.entries, entry) &&
    arrayOf(value.extensions, extension) &&
    arrayOf(value.groups, group)
  );
}
export function decodeScanProgress(value: unknown): ScanProgress {
  if (!progress(value)) throw new Error('扫描进度格式无效');
  return value;
}
export function decodeScanResult(value: unknown): ScanResult {
  if (!result(value)) throw new Error('扫描结果格式无效');
  return value;
}
