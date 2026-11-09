import type {
  ScanResult,
  ScanSort,
  DuplicateGroup,
  DuplicatePlanEntry,
} from './contracts/storage.js';
export function selectScanFiles(
  result: Partial<ScanResult>,
  {
    view = 'files',
    minimumMiB = 0,
    olderDays = 0,
    sort = 'size',
    now = Date.now(),
  }: {
    view?: string;
    minimumMiB?: number | string;
    olderDays?: number;
    sort?: ScanSort;
    now?: number;
  } = {},
) {
  const source = view === 'large' ? result.largestFiles || [] : result.catalog || [],
    minimum = Math.max(0, Number(minimumMiB) || 0) * 1024 ** 2,
    cutoff = olderDays ? now - olderDays * 86400000 : Infinity;
  return source
    .filter((f) => f.size >= minimum && (!olderDays || f.modifiedAt < cutoff))
    .slice()
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'zh-CN')
        : sort === 'modified'
          ? a.modifiedAt - b.modifiedAt
          : b.size - a.size || a.path.localeCompare(b.path),
    );
}
export function duplicatePlan(
  group: DuplicateGroup | null | undefined,
  keep: string,
  candidates: ReadonlySet<string>,
) {
  if (!group || !group.paths.includes(keep)) return [];
  return group.paths
    .filter((p) => p !== keep && candidates.has(p))
    .map((p) => ({ keep, path: p, size: group.size }));
}
export function reportCsv(rows: readonly DuplicatePlanEntry[]) {
  const cell = (v: string | number) =>
    '"' + (/^[=+\-@\t\r]/.test(String(v)) ? "'" : '') + String(v).replaceAll('"', '""') + '"';
  return (
    '\uFEFF' +
    [
      ['保留副本', '待处理副本', '文件逻辑大小（字节）'],
      ...rows.map((r) => [r.keep, r.path, r.size]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  );
}

export const RENAME_SELECTION_LIMIT = 500;
export function duplicateProcessRequest(
  action: 'move' | 'delete',
  destination: string,
  items: readonly DuplicatePlanEntry[],
): import('./contracts/storage.js').DuplicateProcessRequest {
  return {
    action,
    destination,
    confirmed: true,
    items: items.map(({ keep, path }) => ({ keep, path })),
  };
}

// The picker returns absolute paths; normalize separators and dot segments for boundary matching.
export function preferredDuplicateKeeper(group: DuplicateGroup, preferredDirectory = ''): string {
  const normalize = (value: string) => {
    const parts: string[] = [];
    for (const part of value.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  };
  const paths = [...group.paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!preferredDirectory) return paths[0] || '';
  const directory = normalize(preferredDirectory);
  return (
    paths.find((value) => {
      const normalized = normalize(value);
      return directory === '/' || normalized.startsWith(directory + '/');
    }) ||
    paths[0] ||
    ''
  );
}
