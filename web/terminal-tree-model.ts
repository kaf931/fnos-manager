import { connectionPath } from './remote-connections.js';
import type { Connection, WorkspaceItem } from './contracts/terminal.js';
export interface TreeNode {
  id: string;
  name: string;
  kind: WorkspaceItem['kind'] | Connection['kind'];
  nodeType: 'folder' | 'command' | 'connection';
  parentId: string | null;
  scope?: 'assets' | 'commands';
  content?: string;
  children: TreeNode[];
}
export function validateMove(
  rows: WorkspaceItem[],
  id: string,
  parentId: string | null | undefined,
  scope: string,
) {
  if (!parentId) return null;
  let cursor = rows.find((x) => x.id === parentId);
  const seen = new Set([id]);
  if (!cursor || cursor.kind !== 'folder' || cursor.scope !== scope) throw Error('所属目录不存在');
  while (cursor) {
    if (seen.has(cursor.id)) throw Error('目录不能循环嵌套');
    seen.add(cursor.id);
    cursor = rows.find((x) => x.id === cursor?.parentId);
  }
  return parentId;
}
export function buildTree(items: WorkspaceItem[], connections: Connection[] = []): TreeNode[] {
  const rows: Omit<TreeNode, 'children'>[] = [
      ...items.map((x) => ({ ...x, nodeType: x.kind })),
      ...connections.map((x) => ({
        ...x,
        nodeType: 'connection' as const,
        parentId: x.folderId ?? null,
      })),
    ],
    nodes = new Map(rows.map((x) => [x.id, { ...x, children: [] as TreeNode[] }])),
    roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent?.kind === 'folder') parent.children.push(node);
    else roots.push(node);
  }
  function sort(list: TreeNode[]) {
    list.sort(
      (a, b) =>
        (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) ||
        a.name.localeCompare(b.name, 'zh-CN'),
    );
    for (const node of list) sort(node.children);
  }
  sort(roots);
  return roots;
}
export function planTreeMove({
  items,
  connections = [],
  scope,
  id,
  parentId,
}: {
  items: WorkspaceItem[];
  connections?: Connection[];
  scope: string;
  id: string;
  parentId: string | null | undefined;
}) {
  if (!['assets', 'commands'].includes(scope)) throw Error('分类无效');
  const item = items.find((x) => x.id === id && x.scope === scope),
    connection = scope === 'assets' ? connections.find((x) => x.id === id) : null;
  if (!item && !connection) throw Error('移动的条目不存在');
  const parent = validateMove(items, id, parentId, scope),
    previous = connection ? connection.folderId : item?.parentId;
  if ((previous ?? null) === parent) return null;
  return connection
    ? { path: connectionPath(connection) + '/' + id + '/folder', body: { folderId: parent } }
    : { path: '/terminal/workspace/' + id, body: { parentId: parent } };
}
