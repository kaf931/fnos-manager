import { loadConnections, connectionPath } from './remote-connections.js';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ReactDialog } from './ui/react-dialog.js';
import { requestRemoteDialog } from './features/terminal/dialogs.js';
import {
  errorMessage,
  type ApiClient,
  type Toast,
  type ConfirmAction,
} from './contracts/shared.js';
import type { Connection, WorkspaceItem } from './contracts/terminal.js';
import type { TreeNode } from './terminal-tree-model.js';
interface ContextEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  clientX: number;
  clientY: number;
}
import { buildTree, validateMove, planTreeMove } from './terminal-tree-model.js';
function editItem({
  title,
  name = '',
  content,
}: {
  title: string;
  name?: string;
  content?: string;
}): Promise<{ name: string; content?: string } | null> {
  return requestRemoteDialog((finish) => (
    <WorkspaceItemEditor
      title={title}
      initialName={name}
      initialContent={content}
      finish={finish}
    />
  ));
}
function WorkspaceItemEditor({
  title,
  initialName,
  initialContent,
  finish,
}: {
  title: string;
  initialName: string;
  initialContent?: string;
  finish: (value: { name: string; content?: string } | null) => void;
}) {
  const [name, setName] = useState(initialName),
    [content, setContent] = useState(initialContent);
  return (
    <ReactDialog
      open
      title={title}
      onClose={() => finish(null)}
      className="terminal-dialog"
      footer={null}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          finish({ name, ...(content !== undefined ? { content } : {}) });
        }}
      >
        <div className="task-form-body">
          <label>
            名称
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {content !== undefined && (
            <label>
              指令内容（发送时不追加回车）
              <textarea
                required
                rows={8}
                className="code-input"
                spellCheck={false}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={() => finish(null)}>
            取消
          </button>
          <button className="primary">保存</button>
        </div>
      </form>
    </ReactDialog>
  );
}
export function TerminalAssets({
  scope,
  open,
  revision,
  onClose,
  api,
  openConnection,
  editConnection,
  sendCommand,
  confirm,
  onChange,
  toast,
}: {
  scope: string;
  open: boolean;
  revision: number;
  onClose: () => void;
  api: ApiClient;
  openConnection: (connection: Connection) => unknown;
  editConnection: (connection?: Connection | null, parentId?: string | null) => unknown;
  sendCommand: (text: string) => unknown;
  confirm: ConfirmAction;
  onChange?: () => unknown;
  toast?: Toast;
}) {
  const elementRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLDivElement>(null),
    epoch = useRef(0),
    mounted = useRef(true),
    press = useRef<ReturnType<typeof setTimeout> | null>(null),
    dragged = useRef<{ id: string; scope: string } | null>(null),
    dropTarget = useRef<string | null | undefined>(),
    suppressClick = useRef(false);
  const [items, setItems] = useState<WorkspaceItem[]>([]),
    [connections, setConnections] = useState<Connection[]>([]),
    [expanded, setExpanded] = useState(new Set<string>()),
    [moving, setMoving] = useState(false),
    [dragId, setDragId] = useState<string | null>(null),
    [dropId, setDropId] = useState<string | null | undefined>(),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      actions: { label: string; run: () => unknown; danger?: boolean }[];
    } | null>(null);
  const expand = (id: string) => setExpanded((previous) => new Set([...previous, id]));
  useEffect(
    () => () => {
      mounted.current = false;
      epoch.current++;
      if (press.current) clearTimeout(press.current);
    },
    [],
  );
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    const [next, cs] = await Promise.all([
      api<WorkspaceItem[]>('/terminal/workspace?scope=' + scope),
      loadConnections(api),
    ]);
    if (!mounted.current || generation !== epoch.current) return;
    setItems(next);
    setConnections(cs);
  }, [api, scope]);
  useEffect(() => {
    if (open) void refresh().catch((e) => toast?.(errorMessage(e)));
    return () => {
      epoch.current++;
    };
  }, [refresh, open, revision]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      )
        setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useLayoutEffect(() => {
    if (menu && menuRef.current) {
      const height = menuRef.current.offsetHeight;
      menuRef.current.style.top = Math.max(8, Math.min(menu.y, innerHeight - height - 8)) + 'px';
    }
  }, [menu]);
  const guard = (fn: () => unknown | Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (e) {
      toast?.(errorMessage(e));
    }
  };
  const closeMenu = () => setMenu(null);
  async function save(kind: 'folder' | 'command', parentId?: string | null, item?: TreeNode) {
    const selected = scope,
      parent = item?.parentId ?? parentId;
    const data = await editItem({
      title: item
        ? '编辑' + (kind === 'folder' ? '目录' : '指令')
        : '新建' + (kind === 'folder' ? '目录' : '指令'),
      name: item?.name,
      content: kind === 'command' ? item?.content || '' : undefined,
    });
    if (!data || !mounted.current) return;
    if (!item) validateMove(items, '', parent, selected);
    await api('/terminal/workspace' + (item ? '/' + item.id : ''), item ? 'PUT' : 'POST', {
      ...data,
      ...(!item ? { parentId: parent } : {}),
      kind,
      scope: selected,
    });
    if (parent) expand(parent);
    await refresh();
    onChange?.();
  }
  function context(event: ContextEvent, item?: TreeNode) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    const parentId = item?.kind === 'folder' ? item.id : (item?.parentId ?? null);
    const actions: { label: string; run: () => unknown; danger?: boolean }[] = [
      { label: '新建目录', run: () => save('folder', parentId) },
      {
        label: scope === 'assets' ? '新建连接' : '新建指令',
        run: () =>
          scope === 'assets' ? editConnection(null, parentId) : save('command', parentId),
      },
    ];
    if (item)
      actions.push(
        {
          label: item.nodeType === 'connection' ? '编辑连接' : '编辑',
          run: () =>
            item.nodeType === 'connection'
              ? editConnection(connections.find((c) => c.id === item.id))
              : save(item.kind === 'folder' ? 'folder' : 'command', item.parentId, item),
        },
        {
          label: '删除',
          danger: true,
          run: async () => {
            if (
              !(await confirm({
                title: '删除' + (item.kind === 'folder' ? '目录' : '条目'),
                text: `删除“${item.name}”？目录须为空。`,
                danger: true,
                accept: '删除',
              }))
            )
              return;
            await api(
              item.nodeType === 'connection'
                ? connectionPath(connections.find((c) => c.id === item.id) || {}) + '/' + item.id
                : '/terminal/workspace/' + item.id,
              'DELETE',
            );
            await refresh();
            onChange?.();
          },
        },
      );
    setMenu({
      x: Math.max(8, Math.min(event.clientX, innerWidth - 200)),
      y: event.clientY,
      actions,
    });
  }
  function clearPress() {
    if (press.current != null) clearTimeout(press.current);
    press.current = null;
  }
  function clearDrop() {
    setDropId(undefined);
  }
  function endDrag() {
    dragged.current = null;
    dropTarget.current = undefined;
    setDropId(undefined);
    setDragId(null);
  }
  function beginDrag(node: TreeNode) {
    if (moving) return false;
    clearPress();
    closeMenu();
    dragged.current = { id: node.id, scope };
    setDragId(node.id);
    return true;
  }
  function planDrop(parentId: string | null) {
    if (!dragged.current || dragged.current.scope !== scope || moving) return null;
    return planTreeMove({ items, connections, scope, id: dragged.current.id, parentId });
  }
  function showDrop(target: HTMLElement, parentId: string | null) {
    clearDrop();
    dropTarget.current = undefined;
    try {
      const plan = planDrop(parentId);
      if (!plan) return false;
      dropTarget.current = parentId;
      setDropId(parentId);
      return true;
    } catch {
      return false;
    }
  }
  async function moveTo(parentId: string | null) {
    let plan;
    try {
      plan = planDrop(parentId);
    } catch (e) {
      toast?.(errorMessage(e));
      endDrag();
      return;
    }
    endDrag();
    if (!plan) return;
    setMoving(true);
    try {
      await api(plan.path, 'PUT', plan.body);
      if (parentId) expand(parentId);
      await refresh();
      onChange?.();
      toast?.('已移动');
    } catch (e) {
      toast?.(errorMessage(e));
    } finally {
      setMoving(false);
    }
  }
  function dropZone(parentId: string | null): React.HTMLAttributes<HTMLElement> {
    return {
      onDragOver: (e) => {
        e.stopPropagation();
        if (showDrop(e.currentTarget, parentId)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      },
      onDragLeave: (e) => {
        if (
          !(e.relatedTarget instanceof document.defaultView!.Node) ||
          !e.currentTarget.contains(e.relatedTarget)
        )
          clearDrop();
      },
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        void moveTo(parentId);
      },
    };
  }
  function touchTarget(event: { clientX: number; clientY: number }) {
    const target = document.elementFromPoint(event.clientX, event.clientY),
      row = target?.closest<HTMLElement>('.terminal-tree-row'),
      list = target?.closest<HTMLElement>('.terminal-tree');
    if (row?.dataset.treeFolder !== undefined)
      return { target: row, parentId: row.dataset.treeFolder };
    if (!row && list && elementRef.current?.contains(list)) return { target: list, parentId: null };
    return null;
  }
  function row(node: TreeNode, depth: number): React.ReactNode {
    const activate = guard(async () => {
      if (node.kind === 'folder') {
        setExpanded((previous) => {
          const next = new Set(previous);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      } else if (node.nodeType === 'connection') {
        const connection = connections.find((c) => c.id === node.id);
        if (connection) await openConnection(connection);
      } else await sendCommand(node.content ?? '');
    });
    return (
      <React.Fragment key={node.id}>
        <div
          className={
            'terminal-tree-row' +
            (dragId === node.id ? ' tree-dragging' : '') +
            (dropId === node.id ? ' tree-drop-target' : '')
          }
          data-tree-id={node.id}
          data-tree-folder={node.kind === 'folder' ? node.id : undefined}
          draggable
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={node.kind === 'folder' ? expanded.has(node.id) : undefined}
          style={
            { paddingLeft: 8 + depth * 20 + 'px', '--tree-depth': depth } as React.CSSProperties
          }
          onDragStart={(e) => {
            if (!beginDrag(node)) {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', node.id);
          }}
          onDragEnd={() => {
            suppressClick.current = true;
            endDrag();
            setTimeout(() => {
              suppressClick.current = false;
            }, 0);
          }}
          {...(node.kind === 'folder'
            ? dropZone(node.id)
            : {
                onDragOver: (e: React.DragEvent<HTMLElement>) => {
                  e.stopPropagation();
                  clearDrop();
                },
                onDrop: (e: React.DragEvent<HTMLElement>) => {
                  e.preventDefault();
                  e.stopPropagation();
                  endDrag();
                },
              })}
          onContextMenu={(e) => context(e, node)}
          onPointerDown={(e) => {
            if (e.pointerType === 'touch') {
              clearPress();
              const snapshot = scope,
                x = e.clientX,
                y = e.clientY;
              press.current = setTimeout(() => {
                press.current = null;
                if (snapshot === scope)
                  context(
                    { preventDefault() {}, stopPropagation() {}, clientX: x, clientY: y },
                    node,
                  );
              }, 500);
            }
          }}
          onPointerMove={clearPress}
          onPointerCancel={clearPress}
          onPointerUp={clearPress}
        >
          <button
            type="button"
            className="terminal-tree-drag-handle"
            aria-label={'拖动' + node.name}
            onPointerDown={(e) => {
              if (e.pointerType !== 'touch') return;
              e.preventDefault();
              e.stopPropagation();
              if (beginDrag(node)) {
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              e.preventDefault();
              e.stopPropagation();
              const target = touchTarget(e);
              if (target) showDrop(target.target, target.parentId);
              else {
                clearDrop();
                dropTarget.current = undefined;
              }
            }}
            onPointerUp={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.releasePointerCapture(e.pointerId);
              const target = dropTarget.current;
              suppressClick.current = true;
              if (target !== undefined) void moveTo(target);
              else endDrag();
              setTimeout(() => {
                suppressClick.current = false;
              }, 0);
            }}
            onPointerCancel={endDrag}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            ⠿
          </button>
          <button
            className="terminal-tree-label"
            title={node.name}
            onClick={(e) => {
              if (
                !suppressClick.current &&
                ((node.kind === 'folder' && e.detail < 2) || e.detail === 0)
              )
                void activate();
            }}
            onDoubleClick={() => {
              if (node.kind !== 'folder') void activate();
            }}
            onPointerUp={(e) => {
              if (e.pointerType === 'touch' && press.current) {
                clearPress();
                if (node.kind !== 'folder') void activate();
              }
            }}
          >
            <span className="terminal-tree-arrow" aria-hidden="true">
              {node.kind === 'folder' ? (expanded.has(node.id) ? '▾' : '▸') : ''}
            </span>
            <span className="terminal-tree-symbol" aria-hidden="true">
              {node.kind === 'folder' ? '▱' : node.kind === 'command' ? '⌘' : '›_'}
            </span>
            <span className="terminal-tree-name">{node.name}</span>
          </button>
          <button
            className="terminal-tree-more"
            title={node.name + '的更多操作'}
            aria-label={node.name + '的更多操作'}
            onClick={(e) => context(e, node)}
          >
            ⋯
          </button>
        </div>
        {node.kind === 'folder' &&
          expanded.has(node.id) &&
          node.children.map((child) => row(child, depth + 1))}
      </React.Fragment>
    );
  }
  const tree = buildTree(items, scope === 'assets' ? connections : []);
  return (
    <aside ref={elementRef} id="terminal-assets" className="terminal-assets" hidden={!open}>
      <>
        <div className="terminal-assets-header">
          <strong>{scope === 'assets' ? '资产列表' : '快捷指令'}</strong>
          <button title="新建 / 更多" aria-label="分类更多操作" onClick={(e) => context(e)}>
            ⋯
          </button>
          <button title="收起分类" aria-label="收起分类" onClick={onClose}>
            ×
          </button>
        </div>
        <div
          className={'terminal-tree' + (dropId === null ? ' tree-drop-target' : '')}
          role="tree"
          aria-label={scope === 'assets' ? '资产目录树' : '快捷指令目录树'}
          data-tree-root="true"
          onContextMenu={(e) => context(e)}
          {...dropZone(null)}
        >
          {tree.length ? (
            tree.map((node) => row(node, 0))
          ) : (
            <p className="help">点击更多创建{scope === 'assets' ? '目录或连接' : '目录或指令'}</p>
          )}
        </div>
      </>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="terminal-tree-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.actions.map((action) => (
              <button
                key={action.label}
                role="menuitem"
                className={action.danger ? 'danger' : undefined}
                onClick={guard(async () => {
                  closeMenu();
                  await action.run();
                })}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </aside>
  );
}
