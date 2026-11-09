import { WorkspaceRail } from './ui/workspace-rail.js';
import { clampTerminalPanelWidth } from './terminal-panel-resize.js';
import { AppIcon } from './ui/icon-markup.js';
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { TerminalSession, type SessionHandle } from './terminal-view.js';
import { AdbSession } from './adb-session.js';
import { RdpSession } from './rdp-desktop.js';
import { DesktopSession } from './remote-desktop.js';
import { TerminalAssets } from './terminal-assets.js';
import { TerminalCommandLibrary } from './terminal-command-library.js';
import { TerminalTransfers } from './terminal-transfers.js';
import { TerminalMonitor } from './terminal-monitor.js';
import { MonitorSummary } from './terminal-indicators.js';
import { TerminalAi } from './terminal-ai.js';
import { createConfirmation } from './confirmation.js';
import { navigateTabs } from './ui/tab-navigation.js';
import { setTerminalFocus } from './terminal-focus.js';
import type { Connection, SessionIdentity, MonitorData } from './contracts/terminal.js';
import type { ApiClient, Toast, AppState } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
export interface RemoteTab {
  connection: Connection;
  key: number;
}
export function TerminalWorkspace({
  api,
  toast,
  state,
  tabs,
  selectedId,
  active,
  onBack,
  onSelect,
  onClose,
  onEdit,
  onOpen,
  onChanged,
  revision,
  onRegister,
}: {
  api: ApiClient;
  toast: Toast;
  state: AppState;
  tabs: RemoteTab[];
  selectedId: string | null;
  active: boolean;
  onBack: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onEdit: (connection?: Connection | null, parentId?: string | null) => void;
  onOpen: (connection: Connection) => void;
  onChanged: () => void;
  revision: number;
  onRegister: (id: string, handle: SessionHandle | null) => void;
}) {
  const [scope, setScope] = useState<string | null>(null),
    [desktopPanel, setDesktopPanel] = useState(false),
    [identities, setIdentities] = useState<Record<string, SessionIdentity>>({}),
    [monitor, setMonitor] = useState<MonitorData | null>(null),
    [transferCount, setTransferCount] = useState(0),
    [panelWidth, setPanelWidth] = useState(360),
    [workspaceWidth, setWorkspaceWidth] = useState(1280),
    [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null),
    [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const handles = useRef(new Map<string, SessionHandle>()),
    root = useRef<HTMLElement>(null),
    drag = useRef<{ start: number; width: number } | null>(null),
    closing = useRef(new Set<string>());
  const confirm = useMemo(() => createConfirmation(), []);
  const visiblePanelWidth = clampTerminalPanelWidth(panelWidth, workspaceWidth);
  const tabsLatest = useRef(tabs);
  tabsLatest.current = tabs;
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setWorkspaceWidth(width);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const selectedProtocol = tabs.find((t) => t.connection.id === selectedId)?.connection.protocol;
  const desktop =
    selectedProtocol === 'vnc' || selectedProtocol === 'rdp' || selectedProtocol === 'adb';
  const selectedTarget = !desktop && selectedId ? identities[selectedId] || null : null;
  const target = active ? selectedTarget : null;
  useLayoutEffect(() => {
    setTerminalFocus(active);
    return () => setTerminalFocus(false);
  }, [active]);
  useEffect(() => () => confirm.cancel?.(), [confirm]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('deskicons:terminalstate', {
        detail: { active: tabs.some((tab) => identities[tab.connection.id]?.connected) },
      }),
    );
  }, [identities, tabs]);
  async function requestClose(tab: RemoteTab) {
    const id = tab.connection.id;
    if (closing.current.has(id)) return;
    closing.current.add(id);
    try {
      if (
        await confirm({
          title: '关闭连接标签',
          text: `关闭“${tab.connection.name}”并断开此连接？`,
          danger: true,
          accept: '断开并关闭',
        })
      ) {
        if (!tabsLatest.current.includes(tab)) return;
        await handles.current.get(id)?.disconnect();
        if (!tabsLatest.current.includes(tab)) return;
        onClose(id);
        setIdentities((previous) => {
          const next = { ...previous };
          delete next[id];
          return next;
        });
      }
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      closing.current.delete(id);
    }
  }
  const toggle = (value: string) => setScope((current) => (current === value ? null : value));
  const onSession = (id: string, session: SessionIdentity) =>
    setIdentities((previous) => {
      const old = previous[id];
      if (
        old?.id === session.id &&
        old?.generation === session.generation &&
        old?.connected === session.connected
      )
        return previous;
      return { ...previous, [id]: session };
    });
  const sendCommand = async (text: string) => {
    const handle = selectedId ? handles.current.get(selectedId) : null;
    if (!target?.connected || !handle) {
      toast('请先选择已连接的终端');
      return;
    }
    await handle.sendCommand(text);
  };
  return (
    <section
      ref={root}
      id="terminal-session-view"
      className={'terminal-session-view' + (desktop ? ' desktop-active' : '')}
      hidden={!active}
      aria-label="远程连接工作区"
      style={{ '--terminal-panel-width': visiblePanelWidth + 'px' } as React.CSSProperties}
    >
      <WorkspaceRail className="workspace-rail terminal-workspace-rail" aria-label="工作区导航">
        <button id="terminal-back" aria-label="返回连接列表" onClick={onBack}>
          <AppIcon name="back" />
        </button>
        {[
          ['ai', 'AI'],
          ['assets', '资产列表'],
          ['commands', '快捷指令'],
          ['transfers', '文件传输'],
          ['library', '常用命令'],
          ['monitor', '系统监控'],
        ].map(([value, label]) => (
          <button
            key={value}
            id={'terminal-' + value + '-toggle'}
            aria-label={label}
            aria-pressed={scope === value}
            className={scope === value ? 'selected' : ''}
            hidden={desktop && value !== 'assets'}
            onClick={() => toggle(value)}
          >
            <AppIcon
              name={
                {
                  assets: 'folder',
                  commands: 'terminal',
                  ai: 'ai',
                  transfers: 'transfers',
                  library: 'library',
                  monitor: 'monitor',
                }[value] || 'grid'
              }
            />
            {value === 'transfers' && transferCount > 0 && (
              <span className="activity-badge">{transferCount > 99 ? '99+' : transferCount}</span>
            )}
          </button>
        ))}
        <div ref={setControlsHost} className="terminal-vnc-tools" hidden={!desktop} />
        {!desktop && <MonitorSummary data={monitor} />}
      </WorkspaceRail>
      <TerminalAssets
        api={api}
        toast={toast}
        confirm={confirm}
        scope={scope === 'commands' ? 'commands' : 'assets'}
        open={scope === 'assets' || (!desktop && scope === 'commands')}
        revision={revision}
        onClose={() => setScope(null)}
        openConnection={onOpen}
        editConnection={onEdit}
        sendCommand={sendCommand}
        onChange={onChanged}
      />
      <TerminalAi
        api={api}
        toast={toast}
        target={selectedTarget?.id ? { ...selectedTarget, id: selectedTarget.id } : null}
        open={active && !desktop && scope === 'ai'}
        onClose={() => setScope(null)}
      />
      <TerminalTransfers
        api={api}
        target={target}
        open={!desktop && scope === 'transfers'}
        onClose={() => setScope(null)}
        onCount={setTransferCount}
      />
      <TerminalCommandLibrary
        api={api}
        toast={toast}
        confirm={confirm}
        open={!desktop && scope === 'library'}
        onClose={() => setScope(null)}
        insert={(text) => {
          if (!selectedId || !handles.current.get(selectedId)?.insertCommand(text))
            toast('请先连接终端，并在空命令行或匹配的命令前缀后填入');
        }}
      />
      <TerminalMonitor
        api={api}
        target={target}
        open={!desktop && scope === 'monitor'}
        onClose={() => setScope(null)}
        onData={setMonitor}
      />
      <div ref={setPanelHost} style={{ display: 'contents' }} />
      {(scope === 'assets' || (!desktop && scope) || (desktop && desktopPanel)) && (
        <div
          className="terminal-panel-resizer"
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuenow={visiblePanelWidth}
          aria-valuemin={240}
          aria-valuemax={clampTerminalPanelWidth(workspaceWidth, workspaceWidth)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              setPanelWidth(
                e.key === 'Home' ? 240 : clampTerminalPanelWidth(workspaceWidth, workspaceWidth),
              );
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              setPanelWidth((width) =>
                clampTerminalPanelWidth(
                  width + (e.key === 'ArrowRight' ? 20 : -20),
                  workspaceWidth,
                ),
              );
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { start: e.clientX, width: visiblePanelWidth };
          }}
          onPointerMove={(e) => {
            if (drag.current)
              setPanelWidth(
                clampTerminalPanelWidth(
                  drag.current.width + e.clientX - drag.current.start,
                  workspaceWidth,
                ),
              );
          }}
          onPointerUp={(e) => {
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      )}
      <div className="terminal-workspace-main">
        <div className="terminal-tabs" role="tablist" aria-label="连接标签">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={'terminal-tab' + (selectedId === tab.connection.id ? ' selected' : '')}
            >
              <button
                className="terminal-tab-close"
                aria-label={'关闭 ' + tab.connection.name}
                onClick={() => void requestClose(tab)}
              >
                ×
              </button>
              <button
                role="tab"
                id={'terminal-' + tab.key + '-tab'}
                aria-controls={'terminal-' + tab.key}
                tabIndex={selectedId === tab.connection.id ? 0 : -1}
                aria-selected={selectedId === tab.connection.id}
                onKeyDown={(e) => navigateTabs(e, e.currentTarget)}
                onClick={() => onSelect(tab.connection.id)}
              >
                {tab.connection.name}
              </button>
            </div>
          ))}
        </div>
        <div className="terminal-instances">
          {!tabs.length && <div className="terminal-workspace-empty">从资产列表选择连接</div>}
          {tabs.map((tab) => (
            <section
              id={'terminal-' + tab.key}
              role="tabpanel"
              aria-labelledby={'terminal-' + tab.key + '-tab'}
              className="terminal-instance"
              hidden={selectedId !== tab.connection.id}
              key={tab.key}
            >
              {tab.connection.protocol === 'adb' ? (
                <AdbSession
                  connection={tab.connection}
                  api={api}
                  toast={toast}
                  getCsrfToken={() => state.csrfToken}
                  controlsHost={controlsHost}
                  panelHost={panelHost}
                  externalPanel={!!scope}
                  onPanelOpen={(opened) => {
                    if (selectedId === tab.connection.id) {
                      setDesktopPanel(opened);
                      if (opened) setScope(null);
                    }
                  }}
                  active={active && selectedId === tab.connection.id}
                  register={(handle) => {
                    onRegister(tab.connection.id, handle);
                    if (handle) handles.current.set(tab.connection.id, handle);
                    else handles.current.delete(tab.connection.id);
                  }}
                  onSession={(session) => onSession(tab.connection.id, session)}
                />
              ) : tab.connection.protocol === 'rdp' ? (
                <RdpSession
                  connection={tab.connection}
                  api={api}
                  toast={toast}
                  controlsHost={controlsHost}
                  panelHost={panelHost}
                  externalPanel={!!scope}
                  onPanelOpen={(opened) => {
                    if (selectedId === tab.connection.id) {
                      setDesktopPanel(opened);
                      if (opened) setScope(null);
                    }
                  }}
                  active={active && selectedId === tab.connection.id}
                  register={(handle) => {
                    onRegister(tab.connection.id, handle);
                    if (handle) handles.current.set(tab.connection.id, handle);
                    else handles.current.delete(tab.connection.id);
                  }}
                  onSession={(session) => onSession(tab.connection.id, session)}
                />
              ) : tab.connection.protocol === 'vnc' ? (
                <DesktopSession
                  controlsHost={controlsHost}
                  panelHost={panelHost}
                  externalPanel={!!scope}
                  onPanelOpen={(opened) => {
                    if (selectedId === tab.connection.id) {
                      setDesktopPanel(opened);
                      if (opened) setScope(null);
                    }
                  }}
                  connection={tab.connection}
                  api={api}
                  toast={toast}
                  confirm={confirm}
                  active={active && selectedId === tab.connection.id}
                  register={(handle) => {
                    onRegister(tab.connection.id, handle);
                    if (handle) handles.current.set(tab.connection.id, handle);
                    else handles.current.delete(tab.connection.id);
                  }}
                  onSession={(session) => onSession(tab.connection.id, session)}
                />
              ) : (
                <TerminalSession
                  connection={tab.connection}
                  api={api}
                  toast={toast}
                  state={state}
                  confirm={confirm}
                  active={active && selectedId === tab.connection.id}
                  register={(handle) => {
                    onRegister(tab.connection.id, handle);
                    if (handle) handles.current.set(tab.connection.id, handle);
                    else handles.current.delete(tab.connection.id);
                  }}
                  onSession={(session) => onSession(tab.connection.id, session)}
                />
              )}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
