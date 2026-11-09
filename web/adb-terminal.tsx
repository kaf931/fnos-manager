import { bindTerminalTheme } from './terminal-theme.js';
import { useEffect, useRef } from 'react';
import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import '@xterm/xterm/css/xterm.css';

/** A separate device PTY per terminal view; closing the view closes its WebSocket. */
export function AdbTerminal({
  sessionId,
  api,
  active,
  toast,
  register,
}: {
  sessionId: string;
  api: ApiClient;
  active: boolean;
  toast: Toast;
  register: (value: { send: (text: string) => boolean } | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef({ active, toast, register });
  latest.current = { active, toast, register };
  const fit = useRef(() => {});
  useEffect(() => {
    if (active) fit.current();
  }, [active]);
  useEffect(() => {
    let disposed = false,
      socket: WebSocket | undefined;
    let terminal: import('@xterm/xterm').Terminal | undefined;
    let observer: ResizeObserver | undefined;
    let stopTheme: (() => void) | undefined;
    const request = new AbortController();
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);
        if (disposed || !host.current) return;
        terminal = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 3000 });
        const addon = new FitAddon();
        terminal.loadAddon(addon);
        terminal.open(host.current);
        stopTheme = bindTerminalTheme(terminal);
        fit.current = () => {
          if (!disposed && latest.current.active) {
            try {
              addon.fit();
              if (socket?.readyState === WebSocket.OPEN)
                socket.send(
                  JSON.stringify({ type: 'resize', cols: terminal!.cols, rows: terminal!.rows }),
                );
            } catch {
              /* A hidden tab has no layout. */
            }
          }
        };
        fit.current();
        observer = new ResizeObserver(() => fit.current());
        observer.observe(host.current);
        const { ticket } = await api<{ ticket: string }>(
          `/adb/sessions/${encodeURIComponent(sessionId)}/terminal`,
          'POST',
          {},
          request.signal,
        );
        if (disposed) return;
        const url = new URL('/app/deskicons/adb/ws', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('ticket', ticket);
        socket = new WebSocket(url.href);
        socket.binaryType = 'arraybuffer';
        socket.addEventListener('open', () => fit.current());
        const send = (text: string) => {
          if (!latest.current.active || socket?.readyState !== WebSocket.OPEN) return false;
          socket.send(new TextEncoder().encode(text));
          return true;
        };
        latest.current.register({ send });
        terminal.onData((data) => {
          send(data);
        });
        socket.addEventListener('message', (event) => {
          if (!disposed)
            terminal?.write(
              typeof event.data === 'string' ? event.data : new Uint8Array(event.data),
            );
        });
        socket.addEventListener('error', () => {
          if (!disposed) terminal?.writeln('\r\n终端传输失败，请重新打开终端');
        });
        socket.addEventListener('close', () => {
          if (!disposed) terminal?.writeln('\r\n终端连接已关闭');
        });
      } catch (error) {
        if (!disposed) latest.current.toast(errorMessage(error, 'ADB 终端启动失败'));
      }
    })();
    return () => {
      disposed = true;
      request.abort();
      observer?.disconnect();
      stopTheme?.();
      socket?.close();
      terminal?.dispose();
      fit.current = () => {};
      latest.current.register(null);
    };
  }, [sessionId, api]);
  return (
    <div
      ref={host}
      data-terminal-id="terminal-viewport"
      style={{ height: '100%', width: '100%' }}
      aria-label="ADB 交互终端"
    />
  );
}
