import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { TerminalEvent } from '../domain/terminal-files.js';
import type { TerminalConnection } from '../domain/terminal.js';
import { errorInfo, inputRecord } from '../errors.js';
import { fail } from './model.js';
import { TerminalSession } from './session.js';
import type { TerminalStore } from './store.js';
const digest = (t: string) => createHash('sha256').update(t).digest('hex');
export function requestOwner(req: IncomingMessage, gateway: boolean) {
  if (gateway) {
    const uid = req.headers['x-trim-userid'];
    if (
      req.headers['x-trim-isadmin'] !== 'true' ||
      typeof uid !== 'string' ||
      !/^\d{1,10}$/.test(uid)
    )
      throw fail('仅已登录管理员可以使用终端', 403);
    return uid;
  }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''))
    throw fail('开发终端仅允许本机访问', 403);
  return 'development';
}
export function requestOrigin(req: IncomingMessage, gateway: boolean) {
  const origin = req.headers.origin;
  try {
    const u = new URL(origin ?? '');
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin) throw 0;
    if (!gateway && u.host !== req.headers.host) throw 0;
    return origin;
  } catch {
    throw fail('终端请求来源不匹配', 403);
  }
}
export class TicketVault {
  declare now: () => number;
  declare tickets: Map<
    string,
    { ownerUid: string; origin: string; sessionId: string; expiresAt: number }
  >;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.tickets = new Map();
  }
  issue(data: { ownerUid: string; origin: string; sessionId: string }) {
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(digest(ticket), {
      ...data,
      expiresAt: this.now() + 30000,
    });
    return ticket;
  }
  consume(ticket: unknown, ownerUid: string, origin: string) {
    if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) return null;
    const key = digest(ticket),
      item = this.tickets.get(key);
    if (!item) return null;
    if (item.expiresAt <= this.now()) {
      this.tickets.delete(key);
      return null;
    }
    if (item.ownerUid !== ownerUid || item.origin !== origin) return null;
    this.tickets.delete(key);
    return item;
  }
  removeSession(id: string) {
    for (const [key, item] of this.tickets) if (item.sessionId === id) this.tickets.delete(key);
  }
}
interface SessionItem {
  id: string;
  ownerUid: string;
  connection: TerminalConnection;
  origin: string;
  expiry?: NodeJS.Timeout;
  authTimer?: NodeJS.Timeout;
  heartbeat?: NodeJS.Timeout;
  session?: TerminalSession;
  ws?: WebSocket;
  alive?: boolean;
}
export class TerminalService {
  private readonly sessionRemovedListeners = new Set<(id: string) => void>();
  subscribeSessionRemoved(listener: (id: string) => void) {
    this.sessionRemovedListeners.add(listener);
    return () => this.sessionRemovedListeners.delete(listener);
  }
  declare store: TerminalStore;
  declare gateway: boolean;
  declare sessions: Map<string, SessionItem>;
  declare vault: TicketVault;
  declare rates: Map<string | undefined, { since: number; count: number }>;
  declare wss: WebSocketServer;
  declare server: Server | undefined;
  declare upgrade: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;
  declare sweep: NodeJS.Timeout | undefined;

  constructor({ store, gateway }: { store: TerminalStore; gateway: boolean }) {
    this.store = store;
    this.gateway = gateway;
    this.sessions = new Map();
    this.vault = new TicketVault();
    this.rates = new Map();
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 128 * 1024,
      perMessageDeflate: false,
    });
  }
  activeFor(owner: string) {
    return [...this.sessions.values()].filter((s) => s.ownerUid === owner);
  }
  usesConnection(owner: string, id: string) {
    return this.activeFor(owner).some((s) => s.connection.id === id);
  }
  active(owner: string) {
    return [...this.sessions.values()].find((s) => s.ownerUid === owner);
  }
  create(owner: string, connection: TerminalConnection, origin: string) {
    if (this.activeFor(owner).length >= 8) throw fail('每用户最多 8 个终端会话', 409);
    if (this.sessions.size >= 32) throw fail('终端会话已满，请稍后重试', 503);
    const id = randomBytes(16).toString('hex'),
      item: {
        id: string;
        ownerUid: string;
        connection: TerminalConnection;
        origin: string;
        expiry?: NodeJS.Timeout;
      } = { id, ownerUid: owner, connection, origin };
    this.sessions.set(id, item);
    item.expiry = setTimeout(() => this.remove(id), 30000);
    item.expiry.unref?.();
    return {
      id,
      ticket: this.vault.issue({ ownerUid: owner, origin, sessionId: id }),
      expiresAt: Date.now() + 30000,
    };
  }
  remove(id: string) {
    const item = this.sessions.get(id);
    if (!item) return;
    this.sessions.delete(id);
    for (const listener of this.sessionRemovedListeners) listener(id);
    this.vault.removeSession(id);
    clearTimeout(item.expiry);
    clearTimeout(item.authTimer);
    clearInterval(item.heartbeat);
    item.session?.close();
    if (item.ws?.readyState === WebSocket.OPEN) item.ws.close(1000, 'session ended');
  }
  connectedOwned(owner: string, id: string) {
    const item = this.sessions.get(id);
    if (!item || item.ownerUid !== owner) throw fail('会话不存在', 404);
    if (!item.session || item.session.state !== 'connected' || item.session.closed)
      throw fail('SSH 会话未连接', 409);
    return item.session;
  }
  closeOwned(owner: string, id: string) {
    const item = this.sessions.get(id);
    if (!item || item.ownerUid !== owner) throw fail('会话不存在', 404);
    this.remove(id);
  }
  attach(server: Server) {
    if (this.server) throw new Error('Terminal transport already attached');
    this.server = server;
    this.upgrade = (req, socket, head) => {
      const reject = () => {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      };
      try {
        if (
          req.url?.startsWith('/app/deskicons/vnc/ws') ||
          req.url?.startsWith('/app/deskicons/rdp/ws') ||
          req.url?.startsWith('/app/deskicons/adb/')
        )
          return;
        if (req.url !== '/app/deskicons/terminal/ws') return reject();
        const owner = requestOwner(req, this.gateway),
          origin = requestOrigin(req, this.gateway),
          ip = req.socket.remoteAddress,
          now = Date.now();
        let rate = this.rates.get(ip);
        if (!rate || now - rate.since > 60000) {
          rate = { since: now, count: 0 };
          this.rates.set(ip, rate);
        }
        if (++rate.count > 30) return reject();
        this.wss.handleUpgrade(req, socket, head, (ws) => this.bind(ws, owner, origin));
      } catch {
        return reject();
      }
    };
    server.on('upgrade', this.upgrade);
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [ip, r] of this.rates) if (now - r.since > 60000) this.rates.delete(ip);
    }, 60000);
    this.sweep.unref?.();
  }
  bind(ws: WebSocket, owner: string, origin: string) {
    let item: SessionItem | undefined;
    let handling = false,
      outputBytes = 0,
      outputSeq = 0,
      lastAck = 0;
    const pendingOutput = new Map<number, number>();
    const authTimer = setTimeout(() => ws.terminate(), 5000);
    authTimer.unref?.();
    const send = (message: TerminalEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (message.type === 'output') {
        const bytes = Buffer.byteLength(message.data, 'base64');
        if (outputBytes + bytes > 1024 * 1024) {
          ws.send(
            JSON.stringify({
              type: 'error',
              code: 'OUTPUT_LIMIT',
              message: '终端输出超过处理上限，连接已关闭',
            }),
          );
          if (item) this.remove(item.id);
          return;
        }
        outputBytes += bytes;
        message = { ...message, seq: ++outputSeq };
        pendingOutput.set(outputSeq, bytes);
      }
      const text = JSON.stringify(message);
      if (ws.bufferedAmount + Buffer.byteLength(text) > 1024 * 1024) {
        ws.close(1009, 'output limit');
        if (item) this.remove(item.id);
        return;
      }
      ws.send(text);
    };
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (item) this.remove(item.id);
    });
    ws.on('message', async (data, binary) => {
      if (
        binary ||
        (!item &&
          (Array.isArray(data)
            ? data.reduce((total, part) => total + part.length, 0)
            : data.byteLength) > 4096)
      ) {
        ws.close(1008, 'invalid message');
        return;
      }
      let msg;
      try {
        msg = inputRecord(JSON.parse(data.toString()));
        if (!msg || typeof msg.type !== 'string') throw fail('终端消息格式无效');
        if (!item) {
          if (msg.type !== 'authenticate') throw fail('请先验证会话');
          const ticket = this.vault.consume(msg.ticket, owner, origin),
            candidate: SessionItem | undefined = ticket
              ? this.sessions.get(ticket.sessionId)
              : undefined;
          if (!candidate || candidate.id !== msg.id || candidate.ws)
            throw fail('会话已失效，请重新连接');
          item = candidate;
          clearTimeout(authTimer);
          clearTimeout(item.expiry);
          item.ws = ws;
          item.session = new TerminalSession({
            connection: item.connection,
            ownerUid: owner,
            store: this.store,
            emit: (event) => {
              send(event);
              if (event.type === 'state' && event.state === 'disconnected')
                queueMicrotask(() => this.remove(candidate.id));
            },
          });
          let alive = true;
          ws.on('pong', () => {
            alive = true;
          });
          item.heartbeat = setInterval(() => {
            if (!alive) {
              ws.terminate();
              return;
            }
            alive = false;
            ws.ping();
          }, 30000);
          item.heartbeat.unref?.();
          item.session!.start();
          return;
        }
        if (msg.type === 'output-ack') {
          if (
            typeof msg.seq !== 'number' ||
            !Number.isSafeInteger(msg.seq) ||
            msg.seq <= lastAck ||
            !pendingOutput.has(msg.seq)
          )
            throw fail('终端输出确认无效');
          for (const [seq, bytes] of pendingOutput) {
            if (seq > msg.seq) break;
            outputBytes -= bytes;
            pendingOutput.delete(seq);
          }
          lastAck = msg.seq;
          return;
        }
        if (msg.type === 'input') {
          item.session!.input(msg.data);
          return;
        }
        if (msg.type === 'resize') {
          item.session!.resize(msg);
          return;
        }
        if (msg.type === 'disconnect') {
          this.remove(item.id);
          return;
        }
        if (handling) throw fail('正在处理，请稍候');
        handling = true;
        try {
          if (msg.type === 'trust-host') await item.session!.acceptHost(msg);
          else if (msg.type === 'credentials') item.session!.authenticate(msg);
          else throw fail('未知终端操作');
        } finally {
          handling = false;
        }
      } catch (err) {
        send({
          type: 'error',
          code: item ? 'INVALID_MESSAGE' : 'SESSION_EXPIRED',
          message: item
            ? errorInfo(err).status
              ? errorInfo(err).message
              : '终端操作失败'
            : '页面会话已失效，请重新连接',
        });
        if (!item) ws.close(1008, 'authentication failed');
      }
    });
  }
  async close() {
    clearInterval(this.sweep);
    for (const id of [...this.sessions.keys()]) this.remove(id);
    for (const ws of this.wss.clients) ws.terminate();
    if (this.upgrade) this.server?.off('upgrade', this.upgrade);
    await new Promise<void>((resolve, reject) =>
      this.wss.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
