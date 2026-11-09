import { RemoteDesktopStatus, RemoteDesktopTextInput } from './remote-desktop-surfaces.js';
import { createPortal } from 'react-dom';
import { createConfirmation } from './confirmation.js';
import { VncControls, type VncAction } from './vnc-controls.js';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import type RFB from './vnc-client.js';
import type { Connection } from './contracts/terminal.js';
import {
  errorMessage,
  type ApiClient,
  type Toast,
  type ConfirmAction,
} from './contracts/shared.js';
import type { SessionHandle } from './terminal-view.js';
import { createVncLog, authenticationLabel, type VncLogRow } from './vnc-log-model.js';
import { VncLogPanel } from './vnc-log-panel.js';
import { copyText } from './clipboard.js';
import { loadVncModule } from './vnc-loader.js';
import { VncFloatingTools } from './vnc-floating-tools.js';
import { VncClipboardPanel } from './vnc-clipboard-panel.js';
import { VncSettingsPanel } from './vnc-settings-panel.js';
import { DEFAULT_VNC_SETTINGS, type VncSettings } from '../backend/domain/vnc.js';
import { applyVncSettings } from './vnc-session-settings.js';
import type { VncLogEntry } from '../backend/domain/vnc.js';
import './remote-desktop.css';
interface DesktopState {
  connected: boolean;
  keyboardOpen: boolean;
  clipboardDraft: string;
  status: string;
  failure: boolean;
  openPanel: 'logs' | 'clipboard' | 'settings' | null;
  settings: VncSettings;
  settingsDraft: VncSettings;
  savingSettings: boolean;
  dragging: boolean;
  modifiers: { ctrl: boolean; alt: boolean; meta: boolean };
  powerSupported: boolean;
  logs: VncLogRow[];
}
export function DesktopSession({
  connection,
  api,
  toast,
  confirm: _confirm,
  controlsHost,
  panelHost,
  externalPanel,
  onPanelOpen,
  active,
  register,
  onSession,
}: {
  controlsHost: HTMLElement | null;
  panelHost: HTMLElement | null;
  externalPanel: boolean;
  onPanelOpen: (open: boolean) => void;
  connection: Connection;
  api: ApiClient;
  toast: Toast;
  confirm: ConfirmAction;
  active: boolean;
  register: (handle: SessionHandle | null) => void;
  onSession: (session: { id: string | null; generation: number; connected: boolean }) => void;
}) {
  const confirm = useMemo(() => createConfirmation(), []);
  const stageRef = useRef<HTMLDivElement>(null),
    viewportRef = useRef<HTMLDivElement>(null),
    activeRef = useRef(active),
    onSessionRef = useRef(onSession),
    registerRef = useRef(register),
    onPanelOpenRef = useRef(onPanelOpen);
  onPanelOpenRef.current = onPanelOpen;
  activeRef.current = active;
  onSessionRef.current = onSession;
  registerRef.current = register;
  const [snapshot, setSnapshot] = useState<DesktopState>({
    connected: false,
    keyboardOpen: false,
    clipboardDraft: '',
    status: '准备连接…',
    failure: false,
    openPanel: null,
    settings: { ...DEFAULT_VNC_SETTINGS },
    settingsDraft: { ...DEFAULT_VNC_SETTINGS },
    savingSettings: false,
    dragging: false,
    modifiers: { ctrl: false, alt: false, meta: false },
    powerSupported: false,
    logs: [],
  });
  const [fullscreen, setFullscreen] = useState(false),
    [keyboardText, setKeyboardText] = useState('');
  const commands = useRef({
    control: (_action: VncAction) => {},
    text: (_text: string) => {},
    closePanel: () => {},
    clipboard: (_value: string) => {},
    sendClipboard: () => {},
    settings: (_value: VncSettings) => {},
    saveSettings: () => {},
    copyLogs: () => {},
    clearLogs: () => {},
    visibility: (_active: boolean) => {},
  });
  useEffect(() => {
    if (externalPanel) commands.current.closePanel();
  }, [externalPanel]);
  useEffect(() => {
    commands.current.visibility(active);
  }, [active]);
  useEffect(() => {
    const stage = stageRef.current!,
      viewport = viewportRef.current!;
    const onState = (connected: boolean) =>
      onSessionRef.current({ id: null, generation, connected });
    let client: RFB | null = null,
      sessionId: string | null = null,
      connected = false,
      visible = activeRef.current,
      disposed = false,
      generation = 0,
      keyboardOpen = false,
      clipboardDraft = '',
      status = '准备连接…',
      failure = false;
    const log = createVncLog();
    let diagnosticsTimer: ReturnType<typeof setInterval> | undefined;
    const stopDiagnostics = () => {
      clearInterval(diagnosticsTimer);
      diagnosticsTimer = undefined;
    };
    const logSettings = () => {
      const modes = {
        off: '原始尺寸',
        scale: '本地缩放（不会降低远程分辨率）',
        remote: '请求远程调整分辨率',
      };
      log.add(
        'performance',
        'info',
        `图像质量 ${settings.qualityLevel}/9 · 压缩 ${settings.compressionLevel}/9 · ${modes[settings.scaleMode]}；质量和压缩效果取决于服务端编码支持。`,
      );
    };
    let openPanel: 'logs' | 'clipboard' | 'settings' | null = null;
    let settings = { ...DEFAULT_VNC_SETTINGS };
    let settingsDraft = { ...settings };
    let savingSettings = false;
    let settingsLoaded = false,
      settingsDirty = false,
      dragging = false,
      reconnectAllowed = true;
    let settingsRevision = 0;
    let configureLogging: ((level: VncSettings['logging']) => void) | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const modifiers = { ctrl: false, alt: false, meta: false };
    const modifierKeys = { ctrl: 0xffe3, alt: 0xffe9, meta: 0xffeb };
    let readErrorSession: string | null = null;
    const reads = new Map<string, Promise<void>>();
    const readControllers = new Map<string, AbortController>();
    async function readLogs(id: string, attempt: number, epoch = log.epoch) {
      if (reads.has(id)) return reads.get(id);
      const controller = new AbortController();
      readControllers.set(id, controller);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const reading = Promise.race([
        api<{ items: VncLogEntry[] }>(
          '/vnc/sessions/' + id + '/logs',
          'GET',
          undefined,
          controller.signal,
        ),
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => {
            controller.abort();
            resolve(undefined);
          }, 2000);
        }),
      ])
        .then((result) => {
          if (disposed || attempt !== generation) return;
          if (!result) throw new Error('日志读取超时');
          log.merge(id, result.items, epoch);
          update();
        })
        .catch(() => {
          if (
            !disposed &&
            attempt === generation &&
            epoch === log.epoch &&
            readErrorSession !== id
          ) {
            readErrorSession = id;
            log.add('session', 'error', '无法读取后端日志，当前仅显示客户端记录');
            update();
          }
        })
        .finally(() => {
          clearTimeout(timeout);
          reads.delete(id);
          readControllers.delete(id);
        });
      reads.set(id, reading);
      return reading;
    }
    async function finalLogs(id: string, attempt: number) {
      if (disposed) return;
      const epoch = log.epoch;
      await reads.get(id);
      if (!disposed) await readLogs(id, attempt, epoch);
    }
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    const stopHandshakeTimer = () => {
      clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    };
    const update = () => {
      if (!disposed)
        setSnapshot({
          connected,
          keyboardOpen,
          clipboardDraft,
          status,
          failure,
          openPanel,
          settings: { ...settings },
          settingsDraft: { ...settingsDraft },
          savingSettings,
          dragging,
          modifiers: { ...modifiers },
          powerSupported: !!client?.capabilities?.power,
          logs: log.items(),
        });
    };
    const isFullscreen = () => !!viewport && document.fullscreenElement === viewport;
    const exitFullscreen = () => {
      if (isFullscreen())
        void document.exitFullscreen().catch(() => {
          if (!disposed) toast('退出全屏失败，请按 Esc 重试');
        });
    };
    const fullscreenChanged = () => setFullscreen(isFullscreen());
    const fullscreenKey = (event: KeyboardEvent) => {
      if (viewport?.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && isFullscreen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exitFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', fullscreenChanged);
    window.addEventListener('keydown', fullscreenKey, true);
    function focus() {
      if (visible) client?.focus();
    }
    function text(value: string) {
      if (!client || !connected || settings.viewOnly) return;
      for (const c of value) {
        const cp = c.codePointAt(0)!;
        const key = cp === 10 ? 0xff0d : cp <= 255 ? cp : 0x01000000 | cp;
        client.sendKey(key, null);
      }
    }
    function releaseModifiers() {
      for (const key of ['ctrl', 'alt', 'meta'] as const) {
        if (modifiers[key] && client && connected) client.sendKey(modifierKeys[key], null, false);
        modifiers[key] = false;
      }
    }
    function cancelReconnect() {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    function scheduleReconnect(expected: number) {
      if (expected !== generation) return;
      cancelReconnect();
      if (!settings.autoReconnect || !reconnectAllowed || disposed || !connection) return;
      status = `${settings.reconnectDelay / 1000} 秒后重新连接…`;
      log.add('session', 'info', status);
      update();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (!disposed && expected === generation && reconnectAllowed && connection)
          void connectTo(connection);
      }, settings.reconnectDelay);
    }
    async function saveSettings() {
      if (savingSettings) return;
      savingSettings = true;
      const value = { ...settingsDraft };
      update();
      try {
        const saved = await api<VncSettings>('/vnc/settings', 'PUT', value);
        if (disposed) return;
        releaseModifiers();
        settings = { ...saved };
        settingsRevision++;
        settingsDraft = { ...saved };
        settingsLoaded = true;
        settingsDirty = false;
        configureLogging?.(settings.logging);
        if (client) {
          applyVncSettings(client, settings, visible, dragging);
          logSettings();
        }
        if (!settings.autoReconnect) {
          const waiting = reconnectTimer !== undefined;
          cancelReconnect();
          if (waiting && !connected) status = '连接已断开';
        }
        toast('VNC 设置已保存');
      } catch (error) {
        if (!disposed) toast(errorMessage(error));
      } finally {
        savingSettings = false;
        update();
      }
    }
    async function disconnectSession() {
      reconnectAllowed = false;
      cancelReconnect();
      const attempt = ++generation;
      await release();
      if (disposed || attempt !== generation) return;
      status = '连接已断开';
      failure = false;
      update();
    }
    const release = async () => {
      stopDiagnostics();
      stopHandshakeTimer();
      releaseModifiers();
      const id = sessionId;
      sessionId = null;
      const old = client;
      client = null;
      old?.disconnect();
      connected = false;
      onState(false);
      if (id) {
        await finalLogs(id, generation);
        try {
          await api('/vnc/sessions/' + id, 'DELETE');
        } catch {
          /* Socket closure also releases the server-side session. */
        }
      }
    };
    async function connectTo(c: Connection) {
      cancelReconnect();
      reconnectAllowed = true;
      const attempt = ++generation;
      await release();
      if (disposed || attempt !== generation) return;
      log.protect([c.credentials?.password || '']);
      log.begin();
      log.add('session', 'info', `开始连接 ${c.host}:${c.port}`);
      status = '正在连接…';
      failure = false;
      update();
      try {
        if (!settingsLoaded) {
          const revision = settingsRevision;
          const loaded = await api<VncSettings>('/vnc/settings');
          if (disposed || attempt !== generation) return;
          if (revision === settingsRevision) {
            settings = { ...loaded };
            if (!settingsDirty) settingsDraft = { ...settings };
          }
          settingsLoaded = true;
        }
        log.add('session', 'info', '正在加载远程桌面组件');
        update();
        const module = await loadVncModule(() => import('./vnc-client.js'));
        const RFB = module.default;
        configureLogging = module.configureVncLogging;
        if (disposed || attempt !== generation) return;
        configureLogging(settings.logging);
        log.add('session', 'success', '远程桌面组件已就绪');
        update();
        const result = await api<{ id: string; ticket: string }>('/vnc/sessions', 'POST', {
          connectionId: c.id,
        });
        if (disposed || attempt !== generation) {
          await api('/vnc/sessions/' + result.id, 'DELETE').catch(() => {});
          return;
        }
        sessionId = result.id;
        log.add('websocket', 'info', '开始建立 WebSocket 连接');
        const rfb = (client = new RFB(
          stage!,
          (location.protocol === 'https:' ? 'wss:' : 'ws:') +
            '//' +
            location.host +
            '/app/deskicons/vnc/ws?ticket=' +
            encodeURIComponent(result.ticket),
          {
            shared: settings.shared,
            repeaterID: settings.repeaterId,
            credentials: {
              username: c.username || '',
              password: c.credentials?.password || '',
              target: '',
            },
          },
        ));
        applyVncSettings(rfb, settings, visible, dragging);
        logSettings();
        rfb.focusOnClick = true;
        const current = () => attempt === generation && !disposed && client === rfb;
        let authenticationFailed = false;
        const failed = (message: string) => {
          if (!current()) return;
          stopHandshakeTimer();
          status = message;
          failure = true;
          log.add('auth', 'error', message);
          connected = false;
          onState(false);
          update();
        };
        handshakeTimer = setTimeout(() => {
          if (!current()) return;
          failed('VNC 连接超时，请检查认证信息及远程屏幕共享状态');
          void release().then(() => scheduleReconnect(attempt));
        }, 30000);
        rfb.addEventListener('connect', () => {
          if (!current()) return;
          stopHandshakeTimer();
          connected = true;
          log.add('desktop', 'success', 'VNC 认证完成，远程桌面会话已建立');
          let sampledAt = performance.now();
          const sample = () => {
            if (!current() || !connected) return;
            const time = performance.now(),
              elapsed = time - sampledAt;
            sampledAt = time;
            const canvas = stage.querySelector('canvas');
            const updates = rfb.takeUpdateCount?.() ?? 0;
            log.add(
              'performance',
              'info',
              `远程画面 ${canvas ? canvas.width + '×' + canvas.height : '等待首帧'} · 视口 ${Math.round(stage.clientWidth)}×${Math.round(stage.clientHeight)} · ${(elapsed / 1000).toFixed(1)} 秒内完成 ${updates} 次画面更新 · ${visible && document.visibilityState !== 'hidden' ? '当前可见' : '后台/隐藏'}${elapsed > 12000 ? ' · 采样延迟，可能存在后台限流或主线程繁忙' : ''}；静止画面不更新属正常。`,
            );
            if (sessionId && openPanel === 'logs') void readLogs(sessionId, attempt);
            update();
          };
          stopDiagnostics();
          diagnosticsTimer = setInterval(sample, 10000);
          if (sessionId) void readLogs(sessionId, attempt);
          status = '';
          failure = false;
          onState(true);
          update();
          focus();
        });
        rfb.addEventListener('disconnect', (event) => {
          if (!current()) return;
          stopDiagnostics();
          stopHandshakeTimer();
          connected = false;
          onState(false);
          if (!failure) {
            failure = !event.detail.clean;
            status = event.detail.clean
              ? '连接已结束'
              : 'VNC 连接失败，请检查地址、端口、认证及服务状态';
          }
          log.add(
            'disconnect',
            event.detail.clean ? 'info' : 'error',
            event.detail.clean ? '远程连接正常结束' : '远程连接意外中断',
          );
          update();
          const id = sessionId;
          sessionId = null;
          if (id)
            void finalLogs(id, attempt).finally(() =>
              api('/vnc/sessions/' + id, 'DELETE').catch(() => {}),
            );
          releaseModifiers();
          if (!authenticationFailed) scheduleReconnect(attempt);
        });
        rfb.addEventListener('capabilities', () => {
          if (current()) update();
        });
        rfb.addEventListener('securityfailure', (event) => {
          if (!current()) return;
          authenticationFailed = true;
          failed(
            event.detail.reason
              ? 'VNC 认证失败：' + event.detail.reason
              : 'VNC 认证失败，请检查认证信息',
          );
          void release();
        });
        rfb.addEventListener('credentialsrequired', () => {
          if (!current()) return;
          authenticationFailed = true;
          failed('VNC 需要认证信息，请返回编辑连接后重试');
          rfb.disconnect();
        });
        rfb.addEventListener('authenticationselected', (event: CustomEvent<{ type: number }>) => {
          if (current()) {
            log.add('auth', 'info', '协商采用 ' + authenticationLabel(event.detail.type));
            update();
          }
        });
        rfb.addEventListener('firstframe', () => {
          if (current()) {
            const canvas = stage.querySelector('canvas');
            log.add(
              'desktop',
              'success',
              '已收到首个画面更新' +
                (canvas ? `，远程分辨率 ${canvas.width}×${canvas.height}` : ''),
            );
            update();
          }
        });
        rfb.addEventListener('clipboard', (event) => {
          if (current() && openPanel !== 'clipboard') {
            clipboardDraft = event.detail.text.slice(0, 262144);
          }
        });
        rfb.addEventListener(
          'serververification',
          async (event: CustomEvent<{ type: string; publickey: Uint8Array }>) => {
            if (!current()) return;
            if (event.detail.type !== 'RSA' || !crypto.subtle) {
              authenticationFailed = true;
              failed('此 VNC 认证需要 HTTPS 安全环境以核验服务器');
              rfb.disconnect();
              return;
            }
            try {
              const bytes = new Uint8Array(event.detail.publickey),
                digest = await crypto.subtle.digest('SHA-256', bytes);
              const fingerprint = Array.from(new Uint8Array(digest), (b) =>
                b.toString(16).padStart(2, '0'),
              ).join(':');
              const accepted = await confirm({
                title: '核对 VNC 服务器',
                text: '请核对服务器 RSA 公钥 SHA-256 指纹：\n' + fingerprint,
                accept: '信任并连接',
              });
              if (!current()) return;
              if (accepted) rfb.approveServer();
              else {
                authenticationFailed = true;
                rfb.disconnect();
              }
            } catch {
              if (current()) {
                authenticationFailed = true;
                failed('无法核验 VNC 服务器身份');
                rfb.disconnect();
              }
            }
          },
        );
      } catch (error) {
        if (attempt !== generation || disposed) return;
        stopHandshakeTimer();
        status = errorMessage(error);
        failure = true;
        log.add('session', 'error', status);
        update();
        const id = sessionId;
        sessionId = null;
        if (id) void api('/vnc/sessions/' + id, 'DELETE').catch(() => {});
      }
    }
    const pagehide = () => {
      reconnectAllowed = false;
      cancelReconnect();
      generation++;
      void release();
    };
    window.addEventListener('pagehide', pagehide);
    function control(action: VncAction) {
      if (disposed || !visible) return;
      if (action === 'logs' || action === 'clipboard' || action === 'settings') {
        if (action === 'clipboard' && !connected) return;
        openPanel = openPanel === action ? null : action;
        if (openPanel) onPanelOpenRef.current(true);
        if (openPanel === 'logs' && sessionId) void readLogs(sessionId, generation);
        update();
        return;
      }
      if (action === 'fullscreen') {
        if (isFullscreen()) exitFullscreen();
        else if (typeof viewport.requestFullscreen === 'function') {
          const target = viewport;
          void target
            .requestFullscreen()
            .then(() => {
              if ((disposed || !visible) && document.fullscreenElement === target)
                void document.exitFullscreen().catch(() => {});
            })
            .catch(() => {
              if (!disposed) toast('当前环境无法进入全屏，请使用浏览器打开');
            });
        } else toast('当前环境不支持全屏，请使用浏览器打开');
      } else if (action === 'retry') {
        if (connection) void connectTo(connection);
      } else if (action === 'disconnect') {
        void disconnectSession();
      } else if (action === 'shutdown' || action === 'reboot' || action === 'reset') {
        if (!connected || !client?.capabilities?.power || settings.viewOnly) return;
        const target = client,
          attempt = generation;
        const label = action === 'shutdown' ? '关机' : action === 'reboot' ? '重启' : '强制重置';
        void confirm({
          title: `确认${label}`,
          text: `对“${connection?.name || '远程主机'}”执行${label}？`,
          danger: true,
          accept: label,
        })
          .then((accepted) => {
            if (
              !accepted ||
              disposed ||
              generation !== attempt ||
              client !== target ||
              !connected ||
              !visible ||
              settings.viewOnly ||
              target.viewOnly ||
              !target.capabilities?.power
            )
              return;
            if (action === 'shutdown') target.machineShutdown();
            if (action === 'reboot') target.machineReboot();
            if (action === 'reset') target.machineReset();
          })
          .catch(() => toast('操作未完成，请重试'));
      } else if (connected && client) {
        if (settings.viewOnly) return;
        if (action === 'keyboard') {
          keyboardOpen = !keyboardOpen;
          update();
        } else if (action === 'drag') {
          if (settings.scaleMode !== 'off' || !settings.clipViewport) return;
          dragging = !dragging;
          applyVncSettings(client, settings, visible, dragging);
          update();
        } else if (action === 'ctrl' || action === 'alt' || action === 'meta') {
          modifiers[action] = !modifiers[action];
          client.sendKey(modifierKeys[action], null, modifiers[action]);
          update();
        } else {
          if (action === 'ctrl-alt-delete') {
            releaseModifiers();
            client.sendCtrlAltDel();
          }
          if (action === 'tab') client.sendKey(0xff09, null);
          if (action === 'escape') client.sendKey(0xff1b, null);
          if (action === 'alt-tab') {
            client.sendKey(0xffe9, null, true);
            client.sendKey(0xff09, null);
            if (!modifiers.alt) client.sendKey(0xffe9, null, false);
          }
          focus();
        }
      }
    }

    commands.current = {
      control,
      text,
      closePanel: () => {
        openPanel = null;
        update();
      },
      clipboard: (value) => {
        clipboardDraft = value;
        update();
      },
      sendClipboard: () => {
        if (connected && client && !settings.viewOnly) client.clipboardPasteFrom(clipboardDraft);
      },
      settings: (value) => {
        settingsDraft = value;
        settingsDirty = true;
        update();
      },
      saveSettings: () => void saveSettings(),
      copyLogs: () => {
        void copyText(log.text())
          .then(() => toast('连接日志已复制'))
          .catch(() => toast('复制失败，请重试'));
      },
      clearLogs: () => {
        log.clear();
        update();
      },
      visibility: (next) => {
        visible = next;
        if (!next) {
          exitFullscreen();
          releaseModifiers();
          client?.blur();
        }
        if (client) client.setViewOnly(!next || settings.viewOnly);
        update();
      },
    };
    registerRef.current({
      disconnect: disconnectSession,
      reconnect: () => void connectTo(connection),
      insertCommand: () => false,
      sendCommand: async () => {
        toast('快捷指令仅适用于 SSH 连接');
        return false;
      },
    });
    void connectTo(connection);
    return () => {
      disposed = true;
      confirm.cancel?.();
      reconnectAllowed = false;
      cancelReconnect();
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      window.removeEventListener('keydown', fullscreenKey, true);
      exitFullscreen();
      for (const controller of readControllers.values()) controller.abort();
      generation++;
      window.removeEventListener('pagehide', pagehide);
      void release();
      registerRef.current(null);
    };
  }, [connection.id, api]);
  const {
    connected,
    keyboardOpen,
    clipboardDraft,
    status,
    failure,
    openPanel,
    settings,
    settingsDraft,
    savingSettings,
    dragging,
    modifiers,
    powerSupported,
    logs,
  } = snapshot;
  useEffect(() => {
    onPanelOpenRef.current(!!openPanel && active);
  }, [openPanel, active]);
  const controls = (scope: 'rail' | 'fullscreen') => (
    <VncControls
      getPopupContainer={
        scope === 'fullscreen' ? () => viewportRef.current || document.body : undefined
      }
      fullscreen={fullscreen}
      keyboardOpen={keyboardOpen}
      connected={connected}
      canRetry={!connected && status !== '正在连接…'}
      logsOpen={openPanel === 'logs'}
      clipboardOpen={openPanel === 'clipboard'}
      settingsOpen={openPanel === 'settings'}
      viewOnly={settings.viewOnly}
      dragEnabled={settings.scaleMode === 'off' && settings.clipViewport}
      dragging={dragging}
      modifiers={modifiers}
      powerSupported={powerSupported}
      onAction={(action) => commands.current.control(action)}
    />
  );
  const panelLabel =
    openPanel === 'clipboard'
      ? 'VNC 剪贴板'
      : openPanel === 'settings'
        ? 'VNC 设置'
        : 'VNC 连接日志';
  const panel =
    openPanel === 'clipboard' ? (
      <VncClipboardPanel
        value={clipboardDraft}
        connected={connected && !settings.viewOnly}
        onChange={(value) => commands.current.clipboard(value)}
        onSend={() => commands.current.sendClipboard()}
        onClose={() => commands.current.closePanel()}
      />
    ) : openPanel === 'settings' ? (
      <VncSettingsPanel
        value={settingsDraft}
        connected={connected}
        sharedLocked={connected}
        saving={savingSettings}
        onChange={(value) => commands.current.settings(value)}
        onSave={() => commands.current.saveSettings()}
        onClose={() => commands.current.closePanel()}
        getPopupContainer={fullscreen ? () => viewportRef.current || document.body : undefined}
      />
    ) : (
      <VncLogPanel
        items={logs}
        onCopy={() => commands.current.copyLogs()}
        onClear={() => commands.current.clearLogs()}
        onClose={() => commands.current.closePanel()}
      />
    );
  return (
    <div className="remote-desktop-view">
      {active && controlsHost && createPortal(controls('rail'), controlsHost)}
      {active &&
        openPanel &&
        !fullscreen &&
        panelHost &&
        createPortal(
          <aside className="terminal-assets" aria-label={panelLabel}>
            {panel}
          </aside>,
          panelHost,
        )}
      <div className="remote-desktop-viewport" ref={viewportRef}>
        {fullscreen && <VncFloatingTools>{controls('fullscreen')}</VncFloatingTools>}
        <div
          className="remote-desktop-stage"
          data-cursor-mode={settings.cursorMode}
          aria-label="VNC 远程桌面画面"
          ref={stageRef}
        />
        <RemoteDesktopStatus status={status} failure={failure} />
        {keyboardOpen && (
          <RemoteDesktopTextInput
            value={keyboardText}
            connected={connected}
            onChange={setKeyboardText}
            onSend={(value) => commands.current.text(value)}
          />
        )}
        {fullscreen && openPanel && (
          <aside className="terminal-assets vnc-fullscreen-panel" aria-label={panelLabel}>
            {panel}
          </aside>
        )}
      </div>
    </div>
  );
}
