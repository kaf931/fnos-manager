import { bindTerminalTheme } from './terminal-theme.js';
import { AppIcon } from './ui/icon-markup.js';
import { showScrollActivity, clearScrollActivity } from './shared-scrollbars.js';
import { PasswordField } from './password-field.js';
import { usePrivateKeyFile } from './use-private-key-file.js';
import { createConfirmation } from './confirmation.js';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createTerminalRetry } from './terminal-retry.js';
import { createConnectionDiagnostics } from './terminal-diagnostics.js';
import { createOutputSink } from './terminal-output.js';
import { clearRetainedUploads } from './terminal-transfer-retry.js';
import {
  canSendInput,
  normalizeSize,
  auxiliaryKey,
  decodeTerminalEvent,
} from './terminal-protocol.js';
import { sendCommandSafely } from './terminal-dialog-queue.js';
import { shellCommandContext } from './terminal-command-catalog.js';
import { TerminalSuggestions } from './terminal-command-suggestions.js';
import { TerminalFiles } from './terminal-files.js';
import { ReactDialog } from './ui/react-dialog.js';
import {
  errorMessage,
  type ApiClient,
  type Toast,
  type AppState,
  type ConfirmAction,
} from './contracts/shared.js';
import type {
  Connection,
  SessionState,
  SessionIdentity,
  TerminalEvent,
} from './contracts/terminal.js';
export interface SessionHandle {
  disconnect: () => Promise<void>;
  reconnect: () => void;
  sendCommand: (text: string) => Promise<unknown>;
  insertCommand: (text: string) => boolean;
}
export function TerminalSession({
  connection,
  api,
  toast,
  state: appState,
  confirm: _confirm,
  active,
  onSession,
  register,
}: {
  connection: Connection;
  api: ApiClient;
  toast: Toast;
  state: AppState;
  confirm: ConfirmAction;
  active: boolean;
  onSession: (session: SessionIdentity) => void;
  register: (handle: SessionHandle | null) => void;
}) {
  const confirm = useMemo(() => createConfirmation(), []);
  const disconnectRef = useRef<() => Promise<void>>(async () => {});
  const hostRef = useRef<HTMLDivElement>(null),
    workspaceRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null),
    [session, setSession] = useState<SessionIdentity>({
      id: null,
      generation: 0,
      connected: false,
    });
  const [auth, setAuth] = useState(false),
    [ctrl, setCtrl] = useState(false);
  const activeRef = useRef(active),
    ctrlRef = useRef(ctrl),
    onSessionRef = useRef(onSession),
    registerRef = useRef(register);
  activeRef.current = active;
  ctrlRef.current = ctrl;
  onSessionRef.current = onSession;
  registerRef.current = register;
  const sendRef = useRef<(message: Record<string, unknown>) => void>(() => {}),
    fitRef = useRef(() => {});
  const suggestionsRef = useRef({ input: (_data: string) => {}, reset: () => {} });
  const getCsrfToken = useCallback(() => appState.csrfToken, [appState.csrfToken]);
  useEffect(() => {
    if (active) fitRef.current();
    else suggestionsRef.current.reset();
  }, [active]);
  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false,
      sessionId: string | null = null,
      currentState: SessionState = 'disconnected',
      attempt = 0,
      frame = 0;
    let socket: WebSocket | null = null,
      sink: ReturnType<typeof createOutputSink> | undefined;
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        scrollback: 3000,
        convertEol: false,
      }),
      fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    const scrollSurface = host.querySelector<HTMLElement>('.xterm');
    const scrollSubscription = term.onScroll(() => {
      if (scrollSurface) showScrollActivity(scrollSurface);
    });
    setTerminal(term);
    const send = (message: Record<string, unknown>) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    sendRef.current = send;
    const retryInput = createTerminalRetry({
      write: (text) => term.write(text),
      retry: () => void connect(connection),
      canRetry: () => activeRef.current && !disposed && currentState === 'disconnected',
    });
    const diagnostics = createConnectionDiagnostics((line) => retryInput.error(line));
    function state(next: SessionState, retryable = true) {
      currentState = next;
      const identity = { id: sessionId, generation: attempt, connected: next === 'connected' };
      if (!disposed) {
        setSession(identity);
        onSessionRef.current(identity);
      }
      if (next !== 'connected') suggestionsRef.current.reset();
      if (next === 'disconnected' && retryable && !disposed) retryInput.disconnected();
    }
    function error(text = '') {
      if (text) retryInput.error(text);
    }
    function fit() {
      if (!activeRef.current || host.clientWidth < 1 || host.clientHeight < 1) return;
      try {
        fitAddon.fit();
        const size = normalizeSize(term.cols, term.rows);
        if (term.cols !== size.cols || term.rows !== size.rows) term.resize(size.cols, size.rows);
        send({ type: 'resize', ...size });
      } catch {}
    }
    function scheduleFit() {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          fit();
        });
    }
    fitRef.current = scheduleFit;
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(host);
    const stopTheme = bindTerminalTheme(term);
    const dataSubscription = term.onData((data) => {
      if (retryInput.input(data) || !canSendInput(currentState)) return;
      if (ctrlRef.current && data.length === 1) {
        data = auxiliaryKey(data, true);
        setCtrl(false);
        ctrlRef.current = false;
      }
      suggestionsRef.current.input(data);
      send({ type: 'input', data });
    });
    async function release() {
      sink?.dispose();
      const id = sessionId;
      sessionId = null;
      if (id) clearRetainedUploads(id);
      const ws = socket;
      socket = null;
      ws?.close();
      if (id) await api('/terminal/sessions/' + id, 'DELETE').catch(() => {});
    }
    async function disconnect() {
      ++attempt;
      setAuth(false);
      retryInput.reset();
      state('disconnected', false);
      await release();
    }
    disconnectRef.current = disconnect;
    async function connect(c: Connection) {
      const before = attempt;
      await disconnect();
      if (disposed || attempt !== before + 1) return;
      const generation = ++attempt;
      term.write('', () => term.reset());
      sink = createOutputSink({
        write: (data, done) => term.write(data, done),
        ack: (seq) => send({ type: 'output-ack', seq }),
        onOverflow: () => {
          error('终端输出超过处理上限，连接已关闭，请重新连接');
          disconnect();
        },
      });
      error();
      diagnostics.reset();
      state('pending');
      try {
        const created = await api<{ id: string; ticket: string }>('/terminal/sessions', 'POST', {
          connectionId: c.id,
        });
        if (generation !== attempt) {
          await api('/terminal/sessions/' + created.id, 'DELETE').catch(() => {});
          return;
        }
        sessionId = created.id;
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = (socket = new WebSocket(
          `${protocol}//${location.host}/app/deskicons/terminal/ws`,
        ));
        let opened = false;
        ws.onopen = () => {
          opened = true;
          ws.send(JSON.stringify({ type: 'authenticate', id: created.id, ticket: created.ticket }));
        };
        ws.onmessage = async (event) => {
          if (generation !== attempt) return;
          let message: TerminalEvent | null;
          try {
            message = decodeTerminalEvent(JSON.parse(String(event.data)) as unknown);
          } catch {
            error('终端响应无法识别');
            return;
          }
          if (!message) return;
          if (message.type === 'diagnostic') diagnostics.accept(message);
          if (message.type === 'state') {
            state(message.state);
            if (message.state === 'connected') {
              error();
              scheduleFit();
            }
            if (message.state === 'disconnected') {
              setAuth(false);
              release();
            }
          }
          if (message.type === 'host-key') {
            const accepted = await confirm({
              title: message.changed ? '主机密钥已变化' : '确认 SSH 主机',
              text: message.changed
                ? '该地址的主机密钥与之前不同。核实设备后，才可替换信任。'
                : '请核对目标设备的 SSH 主机指纹，确认后继续登录。',
              details: `${message.host}:${message.port}\n${message.algorithm}\n${message.fingerprint}${message.changed ? '\n原指纹：\n' + message.previousFingerprints.join('\n') : ''}`,
              danger: message.changed,
              accept: message.changed ? '替换信任并继续' : '信任并继续',
            });
            if (generation !== attempt) return;
            if (!accepted) {
              await disconnect();
              return;
            }
            send({
              type: 'trust-host',
              fingerprint: message.fingerprint,
              replace: message.changed,
            });
          }
          if (message.type === 'credentials-required') setAuth(true);
          if (message.type === 'output') {
            retryInput.finishLine();
            sink?.accept(message);
          }
          if (message.type === 'error') {
            if (!diagnostics.matchesFailure(message.message))
              error(message.message || '终端连接失败');
            if (currentState === 'credentials' && message.code === 'INVALID_MESSAGE') {
              toast(message.message);
              setAuth(true);
            }
          }
        };
        ws.onclose = () => {
          if (generation !== attempt) return;
          if (!opened) error('无法建立终端连接，请检查 NAS 网关和登录状态');
          if (currentState !== 'disconnected') {
            state('disconnected');
            setAuth(false);
            release();
          }
        };
        ws.onerror = () => {
          if (generation === attempt) error('终端网络连接失败');
        };
      } catch (e) {
        if (generation !== attempt) return;
        error(errorMessage(e));
        state('disconnected');
        await release();
      }
    }

    const handle: SessionHandle = {
      disconnect,
      reconnect: () => void connect(connection),
      sendCommand: async (text) => {
        suggestionsRef.current.reset();
        const generation = attempt;
        return sendCommandSafely(text, {
          connected: () => currentState === 'connected' && generation === attempt,
          send: (data) => send({ type: 'input', data }),
          confirm,
        });
      },
      insertCommand: (text) => {
        if (
          !activeRef.current ||
          currentState !== 'connected' ||
          !text ||
          /[\r\n\x00-\x1f\x7f]/.test(text)
        )
          return false;
        const context = shellCommandContext(term);
        if (!context || !text.startsWith(context.input)) return false;
        suggestionsRef.current.reset();
        const suffix = text.slice(context.input.length);
        if (suffix) send({ type: 'input', data: suffix });
        term.focus();
        return true;
      },
    };
    registerRef.current(handle);
    void connect(connection);
    const pagehide = () => socket?.close();
    window.addEventListener('pagehide', pagehide);
    return () => {
      disposed = true;
      confirm.cancel?.();
      ++attempt;
      void release();
      registerRef.current(null);
      resizeObserver.disconnect();
      stopTheme();
      cancelAnimationFrame(frame);
      dataSubscription.dispose();
      scrollSubscription.dispose();
      if (scrollSurface) clearScrollActivity(scrollSurface);
      window.removeEventListener('pagehide', pagehide);
      term.dispose();
    };
  }, [connection.id, api]);
  return (
    <>
      <div className="terminal-workspace" ref={workspaceRef}>
        <div
          className="terminal-viewport-wrap"
          style={{ position: 'relative', flex: 1, minWidth: 0 }}
        >
          <div
            ref={hostRef}
            data-terminal-id="terminal-viewport"
            style={{ height: '100%', width: '100%' }}
            aria-label="终端内容"
          />
          <TerminalSuggestions
            terminal={terminal}
            host={hostRef}
            enabled={active && session.connected}
            api={api}
            send={(data) => sendRef.current({ type: 'input', data })}
            register={(handler) => {
              suggestionsRef.current = handler;
            }}
          />
        </div>
        <div data-terminal-id="terminal-files-root">
          <TerminalFiles
            api={api}
            toast={toast}
            confirm={confirm}
            session={session}
            getCsrfToken={getCsrfToken}
            workspaceRef={workspaceRef}
            panelId={'files-' + connection.id}
          />
        </div>
      </div>
      <div className="terminal-aux" role="group" aria-label="终端辅助按键">
        {[
          ['Escape', 'Esc'],
          ['Tab', 'Tab'],
          ['Control', 'Ctrl'],
          ['ArrowUp', '↑'],
          ['ArrowDown', '↓'],
          ['ArrowLeft', '←'],
          ['ArrowRight', '→'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={key === 'Control' ? ctrl : undefined}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              if (key === 'Control') {
                setCtrl(!ctrl);
                return;
              }
              if (session.connected) {
                const data = auxiliaryKey(key);
                suggestionsRef.current.input(data);
                sendRef.current({ type: 'input', data });
              }
              terminal?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {auth && (
        <SessionAuth
          connection={connection}
          onClose={() => {
            setAuth(false);
            void disconnectRef.current();
          }}
          onSubmit={(credentials) => {
            sendRef.current({ type: 'credentials', ...credentials });
            setAuth(false);
          }}
        />
      )}
    </>
  );
}
function SessionAuth({
  connection,
  onClose,
  onSubmit,
}: {
  connection: Connection;
  onClose: () => void;
  onSubmit: (value: Record<string, string>) => void;
}) {
  const [method, setMethod] = useState('password'),
    [password, setPassword] = useState(''),
    [privateKey, setPrivateKey] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [error, setError] = useState('');
  const keyFile = useRef<HTMLInputElement>(null);
  const keyReader = usePrivateKeyFile(setPrivateKey, setError);
  return (
    <ReactDialog
      open
      title="SSH 身份认证"
      onClose={onClose}
      className="terminal-dialog"
      footer={null}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (keyReader.isReading()) return;
          onSubmit(
            method === 'password' ? { method, password } : { method, privateKey, passphrase },
          );
        }}
      >
        <div className="task-form-body">
          <p>
            {connection.username}@{connection.host}:{connection.port}
          </p>
          <fieldset className="terminal-choice-field">
            <legend>认证方式</legend>
            <div className="mode-options terminal-choice">
              {['password', 'privateKey'].map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="terminal-once-auth"
                    checked={method === value}
                    onChange={() => {
                      keyReader.cancel();
                      setError('');
                      setMethod(value);
                      setPassword('');
                      setPrivateKey('');
                      setPassphrase('');
                    }}
                  />
                  <AppIcon name={value === 'password' ? 'lock' : 'key'} />
                  <span>{value === 'password' ? '密码' : '私钥'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {method === 'password' ? (
            <label>
              密码
              <PasswordField
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                私钥内容
                <textarea
                  required
                  rows={7}
                  maxLength={65536}
                  value={privateKey}
                  onChange={(e) => {
                    keyReader.cancel();
                    setError('');
                    setPrivateKey(e.target.value);
                  }}
                />
              </label>
              <div className="terminal-key-upload">
                <button
                  type="button"
                  aria-busy={keyReader.reading}
                  onClick={() => keyFile.current?.click()}
                >
                  <AppIcon name="upload" />
                  读取私钥文件
                </button>
                <input
                  ref={keyFile}
                  hidden
                  aria-label="读取私钥文件"
                  type="file"
                  value=""
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void keyReader.read(file);
                  }}
                />
              </div>
              <label>
                私钥口令
                <PasswordField value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </label>
            </>
          )}
          <p className="help">凭据仅用于本次连接，建议使用 HTTPS。</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={keyReader.reading}>
            连接
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
