import { attachAdbTerminal } from './terminal.js';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { TicketVault, requestOwner, requestOrigin } from '../terminal/transport.js';
import type { AdbSessions, AdbSession } from './service.js';
import { screenMaxSize } from './screencast-protocol.js';
import type { AdbScreenSize } from '../domain/adb.js';
import { attachAdbScreencast } from './screencast.js';
export class AdbTransport {
  private readonly channels = new Map<WebSocket, { owner: string; id: string }>();
  private readonly vault = new TicketVault();
  private readonly kinds = new Map<string, 'terminal' | 'screen'>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  private server?: Server;
  private upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  constructor(
    private readonly sessions: AdbSessions,
    private readonly gateway: boolean,
    private readonly root: string,
  ) {}
  ticket(owner: string, id: string, kind: 'terminal' | 'screen') {
    const s = this.sessions.get(owner, id);
    if (this.kinds.size >= 256) throw new Error('ADB 连接票据已满，请稍后重试');
    const ticket = this.vault.issue({ ownerUid: owner, origin: s.origin, sessionId: id });
    this.kinds.set(ticket, kind);
    setTimeout(() => {
      this.kinds.delete(ticket);
      this.vault.consume(ticket, owner, s.origin);
    }, 31000).unref();
    return { ticket };
  }
  attach(server: Server) {
    this.server = server;
    this.upgrade = (req, socket, head) => {
      if (!req.url?.startsWith('/app/deskicons/adb/')) return;
      try {
        const url = new URL(req.url, 'http://localhost'),
          kind =
            url.pathname === '/app/deskicons/adb/ws'
              ? 'terminal'
              : url.pathname === '/app/deskicons/adb/screen/ws'
                ? 'screen'
                : null;
        if (!kind) throw 0;
        const maxSize = kind === 'screen' ? screenMaxSize(url.searchParams.get('maxSize')) : 1280;
        const owner = requestOwner(req, this.gateway),
          origin = requestOrigin(req, this.gateway),
          token = url.searchParams.get('ticket') ?? '';
        if (this.kinds.get(token) !== kind) throw 0;
        const ticket = this.vault.consume(token, owner, origin);
        if (!ticket) throw 0;
        this.kinds.delete(token);
        const s = this.sessions.get(owner, ticket.sessionId);
        if (
          s.origin !== origin ||
          this.channels.size >= 32 ||
          [...this.channels.values()].filter((c) => c.owner === owner).length >= 16 ||
          [...this.channels.values()].filter((c) => c.id === s.id).length >= 4
        )
          throw 0;
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.channels.set(ws, { owner, id: s.id });
          ws.once('close', () => this.channels.delete(ws));
          ws.on('error', () => {});
          if (kind === 'terminal')
            void attachAdbTerminal(this.sessions, s, ws).catch(() =>
              ws.close(1011, 'ADB 终端启动失败'),
            );
          else void this.screen(s, ws, maxSize).catch(() => ws.close(1011, 'ADB 投屏启动失败'));
        });
      } catch {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      }
    };
    server.on('upgrade', this.upgrade);
  }
  private async screen(s: AdbSession, ws: WebSocket, maxSize: AdbScreenSize) {
    const runtime = await this.sessions.runtime.owner(s.ownerUid);
    if (s.abort.signal.aborted || ws.readyState !== WebSocket.OPEN) {
      ws.close();
      return;
    }
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        stop();
        return;
      }
      alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 15000);
    heartbeat.unref();
    ws.on('pong', () => {
      alive = true;
      s.touched = Date.now();
    });
    ws.on('message', () => {
      s.touched = Date.now();
    });
    let disposed = false;
    const stop = () => {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      void close();
      s.disposers.delete(stop);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
    s.disposers.add(stop);
    ws.once('close', stop);
    const close = attachAdbScreencast(ws, {
      serial: s.serial,
      maxSize,
      serverPort: runtime.port,
      serverPath:
        process.env.DESKICONS_SCRCPY_SERVER_PATH ||
        path.join(this.root, 'third-party', 'scrcpy', 'scrcpy-server-v3.1'),
      onClose: stop,
    });
    if (disposed) void close();
  }
  close() {
    if (this.server && this.upgrade) this.server.off('upgrade', this.upgrade);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.kinds.clear();
  }
}
