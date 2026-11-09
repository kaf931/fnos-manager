import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { mountRdpClient } from './rdp-client.js';
import type Guacamole from '../third-party/guacamole/index.js';
import type { Connection, SessionIdentity } from './contracts/terminal.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import type { SessionHandle } from './terminal-view.js';
import { VncControls, type VncAction } from './vnc-controls.js';
import { VncFloatingTools } from './vnc-floating-tools.js';
import { VncClipboardPanel } from './vnc-clipboard-panel.js';
import { VncLogPanel } from './vnc-log-panel.js';
import { createVncLog, type VncLogRow } from './vnc-log-model.js';
import type { VncLogEntry } from '../backend/domain/vnc.js';
import { copyText } from './clipboard.js';
import { RemoteDesktopStatus, RemoteDesktopTextInput } from './remote-desktop-surfaces.js';
import './remote-desktop.css';

/** RDP owns its protocol lifecycle, while sharing the existing desktop UI surfaces. */
export function RdpSession(props: {
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
}) {
  const latest = useRef(props);
  latest.current = props;
  const stage = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const client = useRef<Guacamole.Client | null>(null),
    session = useRef<string | null>(null);
  const library = useRef<typeof Guacamole | null>(null);
  const log = useRef(createVncLog());
  const [revision, setRevision] = useState(0),
    [connected, setConnected] = useState(false),
    [status, setStatus] = useState('正在连接…'),
    [failure, setFailure] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [panel, setPanel] = useState<'logs' | 'clipboard' | null>(null),
    [clipboard, setClipboard] = useState(''),
    [rows, setRows] = useState<VncLogRow[]>([]),
    [keyboardOpen, setKeyboardOpen] = useState(false),
    [text, setText] = useState('');
  const [modifiers, setModifiers] = useState({ ctrl: false, alt: false, meta: false });
  const held = useRef(new Set<number>());
  const releaseModifiers = () => {
    for (const code of held.current) client.current?.sendKeyEvent(0, code);
    held.current.clear();
    setModifiers({ ctrl: false, alt: false, meta: false });
  };
  const generation = useRef(0),
    stop = useRef<() => Promise<void>>(async () => {}),
    keyboard = useRef<Guacamole.Keyboard | null>(null),
    leaveFullscreen = useRef<() => void>(() => {});
  const panelVisible = !!panel && props.active;
  useEffect(() => {
    latest.current.onPanelOpen(panelVisible);
  }, [panelVisible, props.active]);
  useEffect(() => {
    if (props.externalPanel) setPanel(null);
  }, [props.externalPanel]);
  useEffect(() => {
    if (!props.active) {
      leaveFullscreen.current();
      keyboard.current?.reset();
      releaseModifiers();
    }
  }, [props.active]);
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    let disposed = false;
    const isFullscreen = () => document.fullscreenElement === target;
    const changed = () => setFullscreen(isFullscreen());
    const exit = () => {
      if (isFullscreen() && typeof document.exitFullscreen === 'function')
        void document.exitFullscreen().catch(() => {
          if (!disposed) latest.current.toast('退出全屏失败，请按 Esc 重试');
        });
    };
    leaveFullscreen.current = exit;
    const fullscreenKey = (event: KeyboardEvent) => {
      if (target.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && isFullscreen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exit();
      }
    };
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('keydown', fullscreenKey, true);
    return () => {
      disposed = true;
      document.removeEventListener('fullscreenchange', changed);
      window.removeEventListener('keydown', fullscreenKey, true);
      exit();
      leaveFullscreen.current = () => {};
    };
  }, []);
  useEffect(() => {
    const target = stage.current;
    if (!target) return;
    const epoch = ++generation.current;
    let disposed = false,
      id: string | null = null,
      instance: Guacamole.Client | null = null,
      mounted: ReturnType<typeof mountRdpClient> | undefined,
      timeout: ReturnType<typeof setTimeout> | undefined;
    const valid = () => !disposed && generation.current === epoch;
    const publish = () => {
      if (valid()) setRows(log.current.items());
    };
    const readLogs = async () => {
      if (!id) return;
      try {
        const result = await latest.current.api<{ items: VncLogEntry[] }>(
          `/rdp/sessions/${id}/logs`,
        );
        if (valid()) {
          log.current.merge(id, result.items);
          publish();
        }
      } catch {
        /* A closed session can expire before the final poll. */
      }
    };
    const cleanup = async () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      clearInterval(poll);
      releaseModifiers();
      mounted?.dispose();
      keyboard.current = null;
      client.current = null;
      session.current = null;
      latest.current.onSession({ id: null, generation: epoch, connected: false });
      if (id) await latest.current.api(`/rdp/sessions/${id}`, 'DELETE').catch(() => {});
    };
    stop.current = cleanup;
    latest.current.register({
      disconnect: cleanup,
      reconnect: () => setRevision((n) => n + 1),
      sendCommand: async () => {
        throw new Error('RDP 不支持 SSH 指令');
      },
      insertCommand: () => false,
    });
    setConnected(false);
    setFailure(false);
    setStatus('正在连接…');
    log.current.begin();
    log.current.protect([props.connection.credentials?.password || '']);
    let failureReported = false;
    const fail = (message: string) => {
      if (!valid() || failureReported) return;
      failureReported = true;
      clearTimeout(timeout);
      setConnected(false);
      setFailure(true);
      setStatus(message);
      log.current.add('protocol', 'error', message);
      publish();
      void readLogs();
    };
    const poll = setInterval(() => {
      if (latest.current.active) void readLogs();
    }, 10000);
    void (async () => {
      try {
        const [{ default: Guacamole }, { mountRdpClient, bindRdpEvents }] = await Promise.all([
          import('../third-party/guacamole/index.js'),
          import('./rdp-client.js'),
        ]);
        if (!valid()) return;
        library.current = Guacamole;
        const result = await props.api<{ id: string; ticket: string }>('/rdp/sessions', 'POST', {
          connectionId: props.connection.id,
          width: Math.max(320, Math.min(3840, target.clientWidth || 1280)),
          height: Math.max(200, Math.min(2160, target.clientHeight || 720)),
        });
        id = result.id;
        if (!valid()) {
          await props.api(`/rdp/sessions/${id}`, 'DELETE').catch(() => {});
          return;
        }
        session.current = id;
        const url = new URL('/app/deskicons/rdp/ws', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

        const tunnel = new Guacamole.WebSocketTunnel(url.href);
        instance = new Guacamole.Client(tunnel);
        client.current = instance;
        mounted = mountRdpClient(
          target,
          instance,
          () => latest.current.active && valid(),
          (value) => {
            if (valid()) setClipboard(value);
          },
        );
        keyboard.current = mounted.keyboard;
        bindRdpEvents(
          instance,
          (code, message) =>
            fail(message || `RDP 连接失败（${code}），引擎未提供具体原因，请查看连接日志`),
          (state) => {
            if (!valid()) return;
            if (state === 3) {
              if (failureReported) return;
              clearTimeout(timeout);
              setConnected(true);
              setStatus('');
              latest.current.onSession({ id, generation: epoch, connected: true });
              log.current.add(
                'desktop',
                'info',
                '客户端显示通道已建立，等待远程画面；此状态不代表 Windows 登录成功',
              );
              publish();
              mounted?.scale();
            } else if (state === 5) {
              clearTimeout(timeout);
              setConnected(false);
              latest.current.onSession({ id, generation: epoch, connected: false });
              setStatus((old) => old || '连接已结束');
              void readLogs();
            }
          },
        );
        timeout = setTimeout(() => {
          fail('RDP 连接超时，请查看连接日志');
          instance?.disconnect();
        }, 35000);
        instance.connect('ticket=' + encodeURIComponent(result.ticket));
      } catch (error) {
        fail(errorMessage(error));
      }
    })();
    return () => {
      void cleanup();
      latest.current.register(null);
    };
  }, [props.connection.id, revision]);
  const key = (...codes: number[]) => {
    codes.forEach((k) => client.current?.sendKeyEvent(1, k));
    [...codes].reverse().forEach((k) => client.current?.sendKeyEvent(0, k));
  };
  function action(value: VncAction) {
    if (value === 'fullscreen') {
      if (document.fullscreenElement === viewport.current) leaveFullscreen.current();
      else void viewport.current?.requestFullscreen().catch((e) => props.toast(errorMessage(e)));
    } else if (value === 'logs' || value === 'clipboard')
      setPanel((old) => (old === value ? null : value));
    else if (value === 'retry') setRevision((n) => n + 1);
    else if (value === 'disconnect')
      void stop.current().then(() => {
        setConnected(false);
        setStatus('连接已结束');
      });
    else if (value === 'keyboard') setKeyboardOpen((v) => !v);
    else if (value === 'ctrl-alt-delete') key(0xffe3, 0xffe9, 0xffff);
    else if (value === 'alt-tab') key(0xffe9, 0xff09);
    else if (value === 'escape') key(0xff1b);
    else if (value === 'tab') key(0xff09);
    else if (value === 'ctrl' || value === 'alt' || value === 'meta') {
      const code = value === 'ctrl' ? 0xffe3 : value === 'alt' ? 0xffe9 : 0xffeb;
      const down = !held.current.has(code);
      if (down) held.current.add(code);
      else held.current.delete(code);
      client.current?.sendKeyEvent(down ? 1 : 0, code);
      setModifiers((old) => ({ ...old, [value]: down }));
    }
  }
  const controls = (
    <VncControls
      fullscreen={fullscreen}
      keyboardOpen={keyboardOpen}
      connected={connected}
      canRetry={!connected && (failure || status === '连接已结束')}
      modifiers={modifiers}
      getPopupContainer={fullscreen ? () => viewport.current || document.body : undefined}
      clipboardOpen={panel === 'clipboard'}
      logsOpen={panel === 'logs'}
      onAction={action}
      settingsAvailable={false}
    />
  );
  const panelLabel = panel === 'clipboard' ? 'RDP 剪贴板' : 'RDP 连接日志';
  const contents =
    panel === 'clipboard' ? (
      <VncClipboardPanel
        value={clipboard}
        connected={connected}
        onChange={setClipboard}
        onClose={() => setPanel(null)}
        onSend={() => {
          if (!client.current || !library.current) return;
          const writer = new library.current.StringWriter(
            client.current.createClipboardStream('text/plain'),
          );
          writer.sendText(clipboard);
          writer.sendEnd();
        }}
      />
    ) : (
      <VncLogPanel
        items={rows}
        onClose={() => setPanel(null)}
        onCopy={() => {
          void copyText(rows.map((r) => `${r.time} ${r.message}`).join('\n')).catch((e) =>
            props.toast(errorMessage(e)),
          );
        }}
        onClear={() => {
          log.current.clear();
          setRows([]);
        }}
      />
    );
  return (
    <div className="remote-desktop-view">
      {props.active &&
        !fullscreen &&
        props.controlsHost &&
        createPortal(controls, props.controlsHost)}
      <div className="remote-desktop-viewport" ref={viewport}>
        <div className="remote-desktop-stage" ref={stage} tabIndex={0} aria-label="RDP 远程桌面" />
        <RemoteDesktopStatus status={status} failure={failure} />
        {fullscreen && <VncFloatingTools>{controls}</VncFloatingTools>}
        {keyboardOpen && (
          <RemoteDesktopTextInput
            value={text}
            connected={connected}
            onChange={setText}
            onSend={(value) => {
              for (const character of value) {
                const code = character.codePointAt(0)!;
                key(character === '\n' ? 0xff0d : code <= 255 ? code : 0x1000000 + code);
              }
            }}
          />
        )}
        {props.active &&
          panel &&
          (fullscreen ? (
            <aside className="terminal-assets vnc-fullscreen-panel" aria-label={panelLabel}>
              {contents}
            </aside>
          ) : (
            props.panelHost &&
            createPortal(
              <aside className="terminal-assets" aria-label={panelLabel}>
                {contents}
              </aside>,
              props.panelHost,
            )
          ))}
      </div>
    </div>
  );
}
