import type { SessionIdentity, FileEntry, FileContext, PathHistory } from './contracts/terminal.js';

export const validName = (n: unknown): n is string =>
  typeof n === 'string' &&
  !!n &&
  n.length <= 255 &&
  !['.', '..'].includes(n) &&
  !/[\/\x00-\x1f\x7f]/.test(n);
export const joinPath = (p: string, n: string) => (p === '/' ? '' : p) + '/' + n;
export const parentPath = (p: string) =>
  p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
export const isCurrentResponse = (
  a: SessionIdentity | null | undefined,
  b: SessionIdentity | null | undefined,
) => a?.id === b?.id && a?.generation === b?.generation && !!b?.connected;
export function formatSize(n: number) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return `${Number(n.toFixed(i ? 1 : 0))} ${units[i]}`;
}
export function sortEntries(
  entries: FileEntry[],
  key: 'name' | 'type' | 'size' | 'mtime' = 'name',
  descending = false,
) {
  return [...entries].sort(
    (a, b) =>
      Number(b.type === 'directory') - Number(a.type === 'directory') ||
      (key === 'name' || key === 'type'
        ? String(a[key]).localeCompare(String(b[key]), 'zh-CN')
        : (a[key] || 0) - (b[key] || 0)) * (descending ? -1 : 1),
  );
}

export function recordPath(history: PathHistory, path: string, index?: number) {
  if (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < history.paths.length
  ) {
    const paths = [...history.paths];
    paths[index] = path;
    return { paths, index };
  }
  if (history.paths[history.index] === path) return history;
  return { paths: [...history.paths.slice(0, history.index + 1), path], index: history.index + 1 };
}
export const isFileContextCurrent = (
  context: FileContext | null | undefined,
  session: SessionIdentity,
  path: string | undefined,
  sequence: number,
): context is FileContext =>
  !!context &&
  isCurrentResponse(context.session, session) &&
  context.path === path &&
  context.sequence === sequence;
export const shouldOpenEntry = (type: string, activation: string, pointerType = 'mouse') =>
  ['directory', 'link'].includes(type) &&
  (activation === 'keyboard' ||
    (activation === 'double-click' && pointerType !== 'touch') ||
    (activation === 'click' && pointerType === 'touch'));
export function clampFilePanelWidth(width: number, workspaceWidth: number) {
  const maximum = Math.max(0, Math.min(Math.floor(workspaceWidth * 0.7), workspaceWidth - 240));
  return Math.max(0, Math.min(width, maximum));
}
export function formatFileTime(value: number) {
  const date = new Date(value);
  return Number.isFinite(value) && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
}

export function resolveFilePanelResize(width: number, workspaceWidth: number) {
  return width <= 12
    ? { width: 0, collapsed: true }
    : { width: clampFilePanelWidth(width, workspaceWidth), collapsed: false };
}
export const fileContextPath = (context: FileContext) =>
  context.entry ? joinPath(context.path, context.entry.name) : context.path;
