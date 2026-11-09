import { AdbControls } from './adb-controls.js';
import { AdbDeviceInfo } from './adb-device-info.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Connection, SessionIdentity } from './contracts/terminal.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type { SessionHandle } from './terminal-view.js';
import { AppIcon } from './ui/icon-markup.js';
import { RemoteDesktopStatus } from './remote-desktop-surfaces.js';
import { VncFloatingTools } from './vnc-floating-tools.js';
import { VncLogPanel } from './vnc-log-panel.js';
import { createVncLog } from './vnc-log-model.js';
import type { VncLogEntry } from '../backend/domain/vnc.js';
import { copyText } from './clipboard.js';
import { AdbScreen } from './adb-screen.js';
import { AdbTerminal } from './adb-terminal.js';
import { AdbFiles, AdbTransfers, useAdbTransfers } from './adb-files.js';
import './remote-desktop.css';

const tools = [
  ['screen', '投屏', 'phone'],
  ['terminal', '终端', 'terminal'],
  ['files', '文件', 'folder'],
  ['info', '设备信息', 'monitor'],
  ['transfers', '传输', 'transfers'],
  ['logs', '连接日志', 'history'],
] as const;
type Tool = (typeof tools)[number][0];
type Panel = Exclude<Tool, 'screen'>;
export function AdbSession(props: {
  connection: Connection;
  api: ApiClient;
  toast: Toast;
  active: boolean;
  controlsHost: HTMLElement | null;
  panelHost: HTMLElement | null;
  externalPanel: boolean;
  onPanelOpen: (open: boolean) => void;
  register: (handle: SessionHandle | null) => void;
  onSession: (identity: SessionIdentity) => void;
  getCsrfToken?: () => string | undefined;
}) {
  const latest = useRef(props);
  latest.current = props;
  const [revision, setRevision] = useState(0),
    [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState('正在连接…'),
    [failure, setFailure] = useState(false);
  const [screenControls, setScreenControls] = useState<ReactNode>(null);
  const receiveScreenControls = useCallback(
    (controls: ReactNode | null) => setScreenControls(() => controls),
    [],
  );
  const [fullscreen, setFullscreen] = useState(false);
  const leaveFullscreen = useRef(() => {});
  const [panel, setPanel] = useState<Panel | null>(null),
    [info, setInfo] = useState<Record<string, string>>({});
  const [infoLoading, setInfoLoading] = useState(false);
  const [panelError, setPanelError] = useState(''),
    [rows, setRows] = useState<
      ReturnType<typeof createVncLog>['items'] extends () => infer T ? T : never
    >([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const log = useRef(createVncLog()),
    epoch = useRef(0),
    stop = useRef(async () => {});
  const terminal = useRef<{ send: (text: string) => boolean } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const transfers = useAdbTransfers(sessionId, props.getCsrfToken);
  useEffect(() => {
    const target = viewport.current;
    const owned = () => !!target && document.fullscreenElement === target;
    const changed = () => setFullscreen(owned());
    const exit = () => {
      if (owned()) void document.exitFullscreen?.().catch(() => {});
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && owned() && !target?.querySelector('dialog[open]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exit();
      }
    };
    leaveFullscreen.current = exit;
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      window.removeEventListener('keydown', escape, true);
      exit();
      leaveFullscreen.current = () => {};
    };
  }, []);
  useEffect(() => {
    if (!props.active) leaveFullscreen.current();
  }, [props.active]);
  const visible = !!panel && props.active;
  useEffect(() => {
    latest.current.onPanelOpen(visible);
  }, [visible, props.active]);
  useEffect(() => {
    if (props.externalPanel) setPanel(null);
  }, [props.externalPanel]);
  useEffect(() => {
    let disposed = false,
      id: string | null = null;
    const generation = ++epoch.current;
    const valid = () => !disposed && generation === epoch.current;
    const cleanup = async () => {
      if (disposed) return;
      disposed = true;

      latest.current.onSession({ id: null, generation, connected: false });
      if (id) await props.api(`/adb/sessions/${encodeURIComponent(id)}`, 'DELETE').catch(() => {});
    };
    stop.current = async () => {
      setSessionId(null);
      setStatus('连接已断开');
      await cleanup();
    };
    props.register({
      disconnect: () => stop.current(),
      reconnect: () => setRevision((n) => n + 1),
      sendCommand: async (text) => {
        if (!terminal.current?.send(text + '\n')) throw new Error('请先打开 ADB 终端');
      },
      insertCommand: (text) => terminal.current?.send(text) ?? false,
    });
    setSessionId(null);
    setStatus('正在连接…');
    setFailure(false);
    setInfo({});
    setRows([]);
    log.current = createVncLog();
    log.current.begin();
    void props
      .api<{ id: string }>('/adb/sessions', 'POST', { connectionId: props.connection.id })
      .then(async (result) => {
        id = result.id;
        if (!valid()) {
          await props.api(`/adb/sessions/${encodeURIComponent(id)}`, 'DELETE').catch(() => {});
          return;
        }
        setSessionId(id);
        setStatus('');
        latest.current.onSession({ id, generation, connected: true });
      })
      .catch((error) => {
        if (!valid()) return;
        const message = errorMessage(error, 'ADB 连接失败');
        setStatus(message);
        setFailure(true);
        log.current.add('session', 'error', message);
        setRows(log.current.items());
      });
    return () => {
      void cleanup();
      latest.current.register(null);
    };
  }, [props.connection.id, revision]);
  useEffect(() => {
    if (!sessionId || !props.active) return;
    let closed = false;
    const request = new AbortController();
    const read = async () => {
      try {
        const result = await latest.current.api<{ items: VncLogEntry[] }>(
          `/adb/sessions/${encodeURIComponent(sessionId)}/logs`,
          'GET',
          undefined,
          request.signal,
        );
        if (!closed) {
          log.current.merge(
            sessionId,
            result.items.map((row) => ({
              ...row,
              stage:
                row.stage in
                {
                  session: 1,
                  websocket: 1,
                  network: 1,
                  protocol: 1,
                  auth: 1,
                  desktop: 1,
                  performance: 1,
                  disconnect: 1,
                }
                  ? row.stage
                  : 'protocol',
            })),
          );
          setRows(log.current.items());
        }
      } catch {
        /* Session may have expired while the final request was in flight. */
      }
    };
    void read();
    const poll = setInterval(() => void read(), 5000);
    return () => {
      closed = true;
      request.abort();
      clearInterval(poll);
    };
  }, [sessionId, props.active]);
  useEffect(() => {
    if (panel !== 'info' || !sessionId || !props.active) return;
    let closed = false;
    const request = new AbortController();
    setPanelError('');
    setInfo({});
    setInfoLoading(true);
    void latest.current
      .api<{ properties: Record<string, string> }>(
        `/adb/sessions/${encodeURIComponent(sessionId)}/info`,
        'GET',
        undefined,
        request.signal,
      )
      .then((value) => {
        if (!closed) setInfo(value.properties);
      })
      .catch((error) => {
        if (!closed) setPanelError(errorMessage(error));
      })
      .finally(() => {
        if (!closed) setInfoLoading(false);
      });
    return () => {
      closed = true;
      request.abort();
    };
  }, [panel, sessionId, props.active]);
  const open = (tool: Tool) => {
    if (tool === 'screen') setPanel(null);
    else setPanel((current) => (current === tool ? null : tool));
  };
  const toolButton = (tool: Tool) => {
    const entry = tools.find(([key]) => key === tool)!;
    const [, label, glyph] = entry;
    return (
      <button
        key={tool}
        type="button"
        className={'icon-button' + ((panel ?? 'screen') === tool ? ' selected' : '')}
        aria-label={label}
        title={label}
        aria-pressed={(panel ?? 'screen') === tool}
        onClick={() => open(tool)}
      >
        <AppIcon name={glyph} />
      </button>
    );
  };
  const canRetry = !sessionId && (failure || status === '连接已断开');
  const controls = (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={fullscreen ? '退出全屏' : '全屏'}
        title={fullscreen ? '退出全屏' : '全屏'}
        onClick={() => {
          const target = viewport.current;
          if (!target) return;
          const action =
            document.fullscreenElement === target
              ? document.exitFullscreen?.()
              : target.requestFullscreen?.();
          void action?.catch((error) => latest.current.toast(errorMessage(error, '全屏失败')));
        }}
      >
        <AppIcon name="expand" />
      </button>
      {toolButton('screen')}
      {toolButton('terminal')}
      {toolButton('files')}
      {sessionId && screenControls ? (
        screenControls
      ) : (
        <AdbControls
          key="unavailable"
          available={false}
          ready={false}
          software={false}
          onKey={() => {}}
          onAction={() => {}}
          onSoftware={() => {}}
        />
      )}
      {(['info', 'transfers', 'logs'] as const).map(toolButton)}
      <button
        type="button"
        className="icon-button danger"
        aria-label="断开连接"
        title="断开连接"
        disabled={!sessionId}
        onClick={() => void stop.current()}
      >
        <AppIcon name="close" />
      </button>
      {canRetry && (
        <button
          type="button"
          className="icon-button"
          aria-label="重新连接"
          title="重新连接"
          onClick={() => setRevision((n) => n + 1)}
        >
          <AppIcon name="refresh" />
        </button>
      )}
    </>
  );
  const label = tools.find(([tool]) => tool === panel)?.[1] ?? '';
  const contents =
    panel === 'logs' ? (
      <VncLogPanel
        items={rows}
        onClose={() => setPanel(null)}
        onCopy={() =>
          void copyText(log.current.text()).catch((error) => props.toast(errorMessage(error)))
        }
        onClear={() => {
          log.current.clear();
          setRows([]);
        }}
      />
    ) : (
      <>
        <div className="terminal-assets-header">
          <strong>{label}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={'收起' + label}
            onClick={() => setPanel(null)}
          >
            ×
          </button>
        </div>
        {panel === 'terminal' && sessionId && (
          <div className="remote-desktop-viewport">
            <AdbTerminal
              sessionId={sessionId}
              api={props.api}
              active={props.active && !props.externalPanel}
              toast={props.toast}
              register={(value) => {
                terminal.current = value;
              }}
            />
          </div>
        )}
        {panel === 'info' && sessionId && (
          <AdbDeviceInfo properties={info} loading={infoLoading} error={panelError} />
        )}
        {panel === 'files' && sessionId && (
          <AdbFiles
            key={sessionId}
            sessionId={sessionId}
            api={props.api}
            toast={props.toast}
            transfer={(kind, path, file) => {
              const work = transfers.run(kind, path, file);
              if (kind === 'install')
                return work.then(() => {
                  if (mounted.current) setPanel('transfers');
                });
              setPanel('transfers');
              return work;
            }}
          />
        )}
        {panel === 'transfers' && (
          <AdbTransfers items={transfers.items} cancel={transfers.cancel} />
        )}
        {!sessionId && panel !== 'transfers' && <p className="help">连接设备后可使用{label}</p>}
      </>
    );

  return (
    <div className="remote-desktop-view">
      {props.active &&
        !fullscreen &&
        props.controlsHost &&
        createPortal(controls, props.controlsHost)}
      <div className="remote-desktop-viewport" ref={viewport}>
        {sessionId && (
          <AdbScreen
            sessionId={sessionId}
            api={props.api}
            active={props.active}
            onControls={receiveScreenControls}
          />
        )}
        <RemoteDesktopStatus status={status} failure={failure} />
        {props.active && fullscreen && <VncFloatingTools>{controls}</VncFloatingTools>}
        {props.active && fullscreen && panel && (
          <aside className="terminal-assets vnc-fullscreen-panel" aria-label={'ADB ' + label}>
            {contents}
          </aside>
        )}
      </div>
      {props.active &&
        !fullscreen &&
        panel &&
        props.panelHost &&
        createPortal(
          <aside className="terminal-assets" aria-label={'ADB ' + label}>
            {contents}
          </aside>,
          props.panelHost,
        )}
    </div>
  );
}
