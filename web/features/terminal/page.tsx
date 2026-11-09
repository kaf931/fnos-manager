import { EmptyState } from '../../empty-state.js';
import { NativeSelect } from '../../native-select.js';
import { PullRefresh } from '../../pull-refresh.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, type ApiClient, type Toast, type AppState } from '../../contracts/shared.js';
import type { Connection } from '../../contracts/terminal.js';
import {
  loadConnections,
  connectionPath,
  requiresSavedCredentials,
} from '../../remote-connections.js';
import { ConnectionCards } from '../../terminal-connections.js';
import { ConnectionEditor } from './connection-editor.js';
import { RemoteDialogHost } from './dialogs.js';
import type { SessionHandle } from '../../terminal-view.js';
import { TerminalWorkspace, type RemoteTab } from '../../terminal-workspace.js';
import { createConfirmation } from '../../confirmation.js';
import { AppIcon } from '../../ui/icon-markup.js';
import '../../terminal-workspace.css';
export function RemoteConnectionPage({
  services: { api, toast },
  state,
  active,
}: {
  services: { api: ApiClient; toast: Toast };
  state: AppState;
  active: boolean;
}) {
  const [rows, setRows] = useState<Connection[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState(''),
    [tabs, setTabs] = useState<RemoteTab[]>([]),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [workspace, setWorkspace] = useState(false),
    [editing, setEditing] = useState<{
      connection: Connection | null;
      folderId: string | null;
      key: number;
    } | null>(null),
    [revision, setRevision] = useState(0);
  const handles = useRef(new Map<string, SessionHandle>()),
    pendingEdits = useRef(new Set<string>());
  const serial = useRef(0),
    loadEpoch = useRef(0),
    mounted = useRef(true),
    tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const confirm = useMemo(() => createConfirmation(), []);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    try {
      const result = await loadConnections(api);
      if (mounted.current && epoch === loadEpoch.current) {
        setRows(result);
        setError('');
      }
    } catch (e) {
      if (mounted.current && epoch === loadEpoch.current) setError(errorMessage(e));
    }
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadEpoch.current++;
      confirm.cancel?.();
    };
  }, [confirm]);
  useEffect(() => {
    if (active) void load();
  }, [active, load]);
  useEffect(() => {
    const restore = () => {
      void load();
      setRevision((value) => value + 1);
    };
    window.addEventListener('deskicons:configrestored', restore);
    return () => window.removeEventListener('deskicons:configrestored', restore);
  }, [load]);
  const changed = () => {
    void load();
    setRevision((value) => value + 1);
  };
  function closeTab(id: string) {
    setTabs((previous) => {
      const remaining = previous.filter((tab) => tab.connection.id !== id);
      setSelectedId((current) =>
        current === id ? remaining.at(-1)?.connection.id || null : current,
      );
      return remaining;
    });
  }
  async function edit(connection?: Connection | null, folderId: string | null = null) {
    const id = connection?.id;
    if (id && pendingEdits.current.has(id)) return;
    if (id) pendingEdits.current.add(id);
    try {
      if (connection) {
        const tab = tabsRef.current.find((t) => t.connection.id === connection.id);
        if (tab) {
          if (
            !(await confirm({
              title: '断开连接并编辑',
              text: `编辑“${connection.name}”前需要关闭使用此配置的终端标签，并断开连接。是否继续？`,
              danger: true,
              accept: '断开并编辑',
            }))
          )
            return;
          if (!mounted.current || !tabsRef.current.includes(tab)) return;
          await handles.current.get(connection.id)?.disconnect();
          if (!mounted.current || !tabsRef.current.includes(tab)) return;
          closeTab(connection.id);
        }
      }
      if (mounted.current)
        setEditing({ connection: connection || null, folderId, key: ++serial.current });
    } finally {
      if (id) pendingEdits.current.delete(id);
    }
  }

  function open(connection: Connection) {
    if (requiresSavedCredentials(connection)) {
      void edit(connection);
      toast('请先保存认证信息，即可自动连接终端');
      return;
    }
    if (!tabsRef.current.some((tab) => tab.connection.id === connection.id)) {
      if (tabsRef.current.length >= 8) {
        toast('最多打开 8 个连接标签');
        return;
      }
      const next = [...tabsRef.current, { connection, key: ++serial.current }];
      tabsRef.current = next;
      setTabs(next);
    }
    setSelectedId(connection.id);
    setWorkspace(true);
  }
  async function action(action: string, connection: Connection) {
    try {
      if (action === 'connect') return open(connection);
      if (action === 'edit') return edit(connection);
      if (action === 'delete') {
        if (tabsRef.current.some((tab) => tab.connection.id === connection.id)) {
          toast('请先关闭使用此配置的连接标签');
          return;
        }
        if (
          await confirm({
            title: '删除连接',
            text: `删除“${connection.name}”的连接配置？`,
            danger: true,
            accept: '删除',
          })
        ) {
          await api(connectionPath(connection) + '/' + connection.id, 'DELETE');
          changed();
        }
      }
    } catch (e) {
      toast(errorMessage(e));
    }
  }
  const shown = rows.filter(
    (c) =>
      (filter === 'all' || (c.protocol || 'ssh') === filter) &&
      `${c.name} ${c.host} ${c.username}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section id="terminal-page" className="tool-page" hidden={!active}>
      <div id="terminal-list-view" className="terminal-list-view" hidden={workspace}>
        <header className="toolbar task-toolbar">
          <h1 className="sr-only">远程连接</h1>
          <div className="task-toolbar-filters">
            <div className="search">
              <AppIcon name="search" />
              <input
                id="terminal-search"
                type="search"
                aria-label="搜索连接"
                placeholder="搜索名称、地址或用户"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="task-status-field">
              <span id="terminal-filter-label">协议</span>
              <div id="terminal-kind-filter" className="toolbar-select">
                <div className="desktop-toolbar-filter">
                  <NativeSelect
                    aria-labelledby="terminal-filter-label"
                    value={filter}
                    onChange={setFilter}
                    optionList={[
                      { value: 'all', label: '全部' },
                      { value: 'ssh', label: 'SSH' },
                      { value: 'vnc', label: 'VNC' },
                      { value: 'rdp', label: 'RDP' },
                      { value: 'adb', label: 'ADB' },
                    ]}
                  />
                </div>
                <div
                  className="mobile-toolbar-filter"
                  data-scroll-inset
                  role="group"
                  aria-labelledby="terminal-filter-label"
                >
                  {[
                    ['all', '全部'],
                    ['ssh', 'SSH'],
                    ['vnc', 'VNC'],
                    ['rdp', 'RDP'],
                    ['adb', 'ADB'],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="toolbar-actions">
            {!!tabs.length && (
              <button
                id="resume-terminal"
                aria-label="返回连接"
                title="返回连接"
                onClick={() => setWorkspace(true)}
              >
                <AppIcon name="terminal" />
                <span className="toolbar-action-label">返回连接</span>
              </button>
            )}
            <button
              className="primary"
              id="new-terminal"
              aria-label="新增连接"
              title="新增连接"
              onClick={() => void edit()}
            >
              <AppIcon name="plus" />
              <span className="toolbar-action-label">新增连接</span>
            </button>
            <button
              id="reload-terminal"
              className="icon-button toolbar-refresh"
              aria-label="刷新连接"
              onClick={() => void load()}
            >
              <AppIcon name="refresh" />
              <span>刷新</span>
            </button>
          </div>
        </header>
        {error && (
          <div id="terminal-page-error" className="notice error" role="alert">
            {error}
          </div>
        )}
        <PullRefresh onRefresh={load}>
          <section
            id="terminal-connections"
            data-scroll-inset
            className="cards"
            aria-label="远程连接列表"
            hidden={!shown.length}
          >
            <ConnectionCards
              rows={shown}
              onAction={(value, connection) => void action(value, connection)}
              options={{
                tag: (c) => (c.protocol || 'ssh').toUpperCase(),
                description: (c) =>
                  c.protocol === 'adb' && c.transport === 'usb'
                    ? c.serial || 'USB 设备'
                    : (c.username ? c.username + '@' : '') + c.host + ':' + c.port,
                meta: (c) =>
                  c.protocol === 'adb'
                    ? c.transport === 'usb'
                      ? 'USB 调试'
                      : '网络调试'
                    : c.protocol === 'vnc' || c.protocol === 'rdp'
                      ? '屏幕共享'
                      : !c.hasCredentials
                        ? '待设置认证'
                        : c.authMethod === 'privateKey'
                          ? '私钥认证'
                          : '密码认证',
                iconPath: (c) =>
                  c.protocol === 'vnc' || c.protocol === 'rdp'
                    ? 'M3 4h18v13H3zM8 21h8M12 17v4'
                    : 'm5 6 6 6-6 6M13 18h6',
                actionLabel: '连接',
              }}
            />
          </section>
          {!shown.length && (
            <EmptyState
              id="terminal-empty"
              subject="连接"
              total={rows.length}
              title="连接你的设备"
              icon="terminal"
              description="通过 SSH 管理主机、VNC / RDP 访问桌面，或通过 ADB 连接 Android。"
              onAdd={() => void edit()}
            />
          )}
        </PullRefresh>
      </div>
      <TerminalWorkspace
        api={api}
        toast={toast}
        state={state}
        tabs={tabs}
        selectedId={selectedId}
        active={active && workspace}
        onBack={() => setWorkspace(false)}
        onSelect={setSelectedId}
        onClose={closeTab}
        onEdit={(connection, folderId) => void edit(connection, folderId)}
        onOpen={open}
        onChanged={changed}
        revision={revision}
        onRegister={(id, handle) => {
          if (handle) handles.current.set(id, handle);
          else handles.current.delete(id);
        }}
      />
      {editing && (
        <ConnectionEditor
          key={editing.key}
          connection={editing.connection}
          folderId={editing.folderId}
          api={api}
          toast={toast}
          onClose={() => setEditing(null)}
          onSave={changed}
        />
      )}
      <RemoteDialogHost />
    </section>
  );
}
