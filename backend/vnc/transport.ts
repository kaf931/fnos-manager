import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { TicketVault, requestOwner, requestOrigin } from '../terminal/transport.js';
import type { VncConnection } from '../domain/vnc.js';
import { fail } from '../terminal/model.js';
import { VncLogStore, vncNetworkError } from './logs.js';
import { createVncOutput } from './output.js';
interface Session {
  id: string;
  ownerUid: string;
  origin: string;
  connection: VncConnection;
  expiry?: NodeJS.Timeout;
  ws?: WebSocket;
  socket?: Socket;
  heartbeat?: NodeJS.Timeout;
  diagnostics?: NodeJS.Timeout;
  report?: () => void;
  alive?: boolean;
  output?: ReturnType<typeof createVncOutput>;
}
/** Authenticated, fixed-target binary RFB relay. VNC authentication remains in noVNC. */
export class VncTransport {
  readonly sessions = new Map<string, Session>();
  readonly vault = new TicketVault();
  readonly logs = new VncLogStore();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
    perMessageDeflate: false,
  });
  private server?: Server;
  private upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  constructor(private readonly gateway: boolean) {}
  uses(owner: string, id: string) {
    return [...this.sessions.values()].some((s) => s.ownerUid === owner && s.connection.id === id);
  }
  create(owner: string, connection: VncConnection, origin: string) {
    if (
      this.sessions.size >= 32 ||
      [...this.sessions.values()].filter((s) => s.ownerUid === owner).length >= 8
    )
      throw fail('VNC 会话已满', 409);
    const id = randomBytes(16).toString('hex'),
      item: Session = { id, ownerUid: owner, origin, connection };
    this.sessions.set(id, item);
    this.logs.create(id, owner);
    this.logs.append(id, 'session', 'success', '连接会话已创建');
    item.expiry = setTimeout(() => this.remove(id), 30000);
    item.expiry.unref();
    return { id, ticket: this.vault.issue({ ownerUid: owner, origin, sessionId: id }) };
  }
  remove(id: string) {
    const item = this.sessions.get(id);
    if (!item) return;
    this.sessions.delete(id);
    clearInterval(item.diagnostics);
    item.report?.();
    this.logs.append(id, 'disconnect', 'info', '后端连接已结束');
    this.logs.close(id);
    this.vault.removeSession(id);
    clearTimeout(item.expiry);
    clearInterval(item.heartbeat);
    item.output?.dispose();
    item.socket?.destroy();
    if (item.ws?.readyState === WebSocket.OPEN) item.ws.close(1000);
  }
  closeOwned(owner: string, id: string) {
    if (this.sessions.get(id)?.ownerUid !== owner) this.logs.read(owner, id);
    this.remove(id);
    this.logs.delete(id);
  }
  attach(server: Server) {
    if (this.server) throw new Error('VNC transport already attached');
    this.server = server;
    this.upgrade = (req, socket, head) => {
      if (!req.url?.startsWith('/app/deskicons/vnc/ws')) return;
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/app/deskicons/vnc/ws') throw 0;
        const owner = requestOwner(req, this.gateway),
          origin = requestOrigin(req, this.gateway);
        const ticket = this.vault.consume(url.searchParams.get('ticket'), owner, origin),
          item = ticket ? this.sessions.get(ticket.sessionId) : undefined;
        if (!item || item.ws || item.ownerUid !== owner || item.origin !== origin) throw 0;
        this.wss.handleUpgrade(req, socket, head, (ws) => this.bind(item, ws));
      } catch {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      }
    };
    server.on('upgrade', this.upgrade);
  }
  private bind(item: Session, ws: WebSocket) {
    item.ws = ws;
    this.logs.append(item.id, 'websocket', 'success', 'WebSocket 已通过身份及来源校验');
    this.logs.append(item.id, 'network', 'info', '正在连接目标 VNC 服务');
    clearTimeout(item.expiry);
    const connectingAt = Date.now();
    const socket = (item.socket = connect(item.connection.port, item.connection.host));
    const abort = (reason: string) => {
      this.logs.append(item.id, 'network', 'error', reason);
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, reason);
      this.remove(item.id);
    };
    const output = (item.output = createVncOutput(socket, ws, abort));
    item.expiry = setTimeout(() => abort('VNC 连接超时'), 15000);
    item.expiry.unref();
    socket.once('lookup', (error) =>
      this.logs.append(
        item.id,
        'network',
        error ? 'error' : 'success',
        error ? vncNetworkError(error) : '主机名解析成功',
      ),
    );
    socket.once('connect', () => {
      clearTimeout(item.expiry);
      this.logs.append(
        item.id,
        'network',
        'success',
        `目标 TCP 连接成功，用时 ${Date.now() - connectingAt} ms`,
      );
    });
    let banner = Buffer.alloc(0);
    let bannerRead = false;
    socket.on('data', (chunk) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!bannerRead) {
        banner = Buffer.concat([banner, chunk.subarray(0, 12 - banner.length)]);
        if (banner.length === 12) {
          bannerRead = true;
          const version = banner.toString('ascii');
          if (/^RFB \d{3}\.\d{3}\n$/.test(version))
            this.logs.append(
              item.id,
              'protocol',
              'success',
              '收到 VNC 协议握手：' + version.trim(),
            );
          else
            this.logs.append(item.id, 'protocol', 'error', '目标返回的内容不是有效 VNC 协议握手');
          banner = Buffer.alloc(0);
        }
      }
      output.send(chunk);
    });
    socket.once('error', (error) => abort(vncNetworkError(error)));
    socket.once('close', () => this.remove(item.id));
    ws.on('message', (data, binary) => {
      if (!binary) {
        abort('仅支持二进制 VNC 数据');
        return;
      }
      if (socket.writableLength > 4 * 1024 * 1024) {
        abort('VNC 输入过快');
        return;
      }
      if (Array.isArray(data)) socket.write(Buffer.concat(data));
      else socket.write(data instanceof ArrayBuffer ? Buffer.from(data) : data);
    });
    ws.once('close', () => this.remove(item.id));
    ws.on('error', () => {
      this.logs.append(item.id, 'websocket', 'error', 'WebSocket 传输失败');
      this.remove(item.id);
    });
    let pingSentAt: number | undefined, rttMs: number | undefined;
    item.alive = true;
    ws.on('pong', () => {
      item.alive = true;
      if (pingSentAt !== undefined) rttMs = Math.max(0, Date.now() - pingSentAt);
      pingSentAt = undefined;
    });
    item.report = () => {
      const sample = output.sample();
      const rate = (bytes: number) => ((bytes * 1000) / sample.intervalMs / 1024).toFixed(1);
      this.logs.append(
        item.id,
        'performance',
        'info',
        `采样 ${(sample.intervalMs / 1000).toFixed(1)} 秒 · 目标→NAS ${rate(sample.receivedBytes)} KiB/s · NAS→WebSocket ${rate(sample.sentBytes)} KiB/s · 待发送 ${(sample.bufferedBytes / 1024).toFixed(1)} KiB（峰值 ${(sample.peakBufferedBytes / 1024).toFixed(1)} KiB）· 最长发送等待 ${sample.maxSendMs} ms · 心跳往返 ${rttMs === undefined ? '等待采样' : rttMs + ' ms'}`,
      );
    };
    this.logs.append(
      item.id,
      'performance',
      'info',
      '速率与队列为 NAS 侧采样，发送完成不代表客户端已显示；心跳为 NAS 与客户端间的 WebSocket 往返，无法据此确认是否经过中继。',
    );
    item.diagnostics = setInterval(() => item.report?.(), 10000);
    item.diagnostics.unref();
    pingSentAt = Date.now();
    ws.ping();
    item.heartbeat = setInterval(() => {
      if (!item.alive) {
        this.logs.append(item.id, 'websocket', 'error', 'WebSocket 心跳超时');
        this.remove(item.id);
        ws.terminate();
        return;
      }
      item.alive = false;
      pingSentAt = Date.now();
      ws.ping();
    }, 15000);
    item.heartbeat.unref();
  }
  close() {
    if (this.server && this.upgrade) this.server.off('upgrade', this.upgrade);
    for (const id of [...this.sessions.keys()]) this.remove(id);
    for (const ws of this.wss.clients) ws.terminate();
    this.logs.clear();
    this.wss.close();
  }
}
