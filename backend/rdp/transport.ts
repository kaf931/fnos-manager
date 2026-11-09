import { RDP_SECURITY_LABELS, RDP_CERTIFICATE_LABELS } from '../domain/rdp.js';
import { rdpEngineError } from './errors.js';
import type { VncLogStage } from '../domain/vnc.js';
import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { TicketVault, requestOwner, requestOrigin } from '../terminal/transport.js';
import type { RdpConnection } from '../domain/rdp.js';
import { fail } from '../terminal/model.js';
import { VncLogStore } from '../vnc/logs.js';
import { GuacamoleParser, instruction, rdpArguments } from './protocol.js';
interface Session {
  id: string;
  ownerUid: string;
  origin: string;
  connection: RdpConnection;
  width: number;
  height: number;
  expiry?: NodeJS.Timeout;
  ws?: WebSocket;
  socket?: Socket;
  heartbeat?: NodeJS.Timeout;
  alive?: boolean;
  ready?: boolean;
}
/** Only the server supplies guacd connection parameters. Browser input is post-handshake only. */
export class RdpTransport {
  readonly sessions = new Map<string, Session>();
  readonly vault = new TicketVault();
  readonly logs = new VncLogStore();
  private wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has('guacamole') ? 'guacamole' : false),
  });
  private server?: Server;
  private upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  constructor(
    private readonly gateway: boolean,
    private readonly port = 14822,
  ) {}
  uses(owner: string, id: string) {
    return [...this.sessions.values()].some((s) => s.ownerUid === owner && s.connection.id === id);
  }
  create(owner: string, connection: RdpConnection, origin: string, width = 1280, height = 720) {
    if (
      this.sessions.size >= 16 ||
      [...this.sessions.values()].filter((s) => s.ownerUid === owner).length >= 4
    )
      throw fail('RDP 会话已满', 409);
    const id = randomBytes(16).toString('hex');
    const item: Session = { id, ownerUid: owner, origin, connection, width, height };
    this.sessions.set(id, item);
    this.logs.create(id, owner);
    this.logs.append(id, 'session', 'success', '连接会话已创建');
    this.logs.append(
      id,
      'protocol',
      'info',
      `目标 ${connection.host.includes(':') ? '[' + connection.host + ']' : connection.host}:${connection.port} · 安全模式 ${RDP_SECURITY_LABELS[connection.security] ?? 'NLA'} · 证书策略 ${RDP_CERTIFICATE_LABELS[connection.certificatePolicy] ?? '严格验证'} · 请求桌面 ${width}×${height}`,
    );
    item.expiry = setTimeout(() => this.remove(id), 30000);
    item.expiry.unref();
    return { id, ticket: this.vault.issue({ ownerUid: owner, origin, sessionId: id }) };
  }
  remove(id: string) {
    const item = this.sessions.get(id);
    if (!item) return;
    this.sessions.delete(id);
    this.vault.removeSession(id);
    clearTimeout(item.expiry);
    clearInterval(item.heartbeat);
    item.socket?.destroy();
    if (item.ws?.readyState === WebSocket.OPEN) item.ws.close(1000);
    this.logs.append(id, 'disconnect', 'info', '后端连接已结束');
    this.logs.close(id);
  }
  closeOwned(owner: string, id: string) {
    if (this.sessions.get(id)?.ownerUid !== owner) this.logs.read(owner, id);
    this.remove(id);
    this.logs.delete(id);
  }
  attach(server: Server) {
    if (this.server) throw new Error('RDP transport already attached');
    this.server = server;
    this.upgrade = (req, socket, head) => {
      if (!req.url?.startsWith('/app/deskicons/rdp/ws')) return;
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/app/deskicons/rdp/ws') throw 0;
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
    clearTimeout(item.expiry);
    this.logs.append(item.id, 'websocket', 'success', 'WebSocket 已通过身份及来源校验');
    const socket = (item.socket = connect(this.port, '127.0.0.1'));
    let failed = false;
    const abort = (message: string, code = '512', stage: VncLogStage = 'network') => {
      if (failed) return;
      failed = true;
      this.logs.append(item.id, stage, 'error', message);
      console.error(
        JSON.stringify({
          event: 'rdp_connection_failed',
          time: new Date().toISOString(),
          sessionId: item.id,
          connectionId: item.connection.id,
          stage,
          code,
          message,
        }),
      );
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(instruction('error', message, code));
        ws.close(1011, 'RDP connection failed');
      }
      this.remove(item.id);
    };
    item.expiry = setTimeout(() => abort('RDP 握手超时'), 30000);
    item.expiry.unref();
    let argsRead = false;
    const parser = new GuacamoleParser((values) => {
      if (failed) return;
      const [op, ...args] = values;
      if (op === 'error') {
        const error = rdpEngineError(args[0], args[1], item.connection.password, item.connection);
        abort(error.message, error.code, 'protocol');
        return;
      }
      if (!item.ready) {
        if (op === 'args' && !argsRead) {
          argsRead = true;
          const config = rdpArguments(item.connection, item.width, item.height);
          socket.write(
            instruction('size', String(item.width), String(item.height), '96') +
              instruction('audio') +
              instruction('video') +
              instruction('image', 'image/png', 'image/jpeg') +
              instruction(
                'connect',
                ...args.map((name) =>
                  name.startsWith('VERSION_') ? 'VERSION_1_5_0' : (config[name] ?? ''),
                ),
              ),
          );
        } else if (op === 'ready' && argsRead) {
          item.ready = true;
          clearTimeout(item.expiry);
          this.logs.append(item.id, 'protocol', 'info', 'RDP 网关握手已完成，等待远程桌面响应');
          ws.send(instruction('', item.id));
        } else throw new Error('Unexpected handshake');
      } else if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 8 * 1024 * 1024) throw new Error('Output overflow');
        ws.send(instruction(...values), (error) => {
          if (error) abort('RDP 画面传输失败');
          else if (ws.bufferedAmount < 1024 * 1024) socket.resume();
        });
        if (ws.bufferedAmount > 1024 * 1024) socket.pause();
      }
    });
    socket.once('connect', () => socket.write(instruction('select', 'rdp')));
    socket.on('data', (data) => {
      try {
        parser.push(data);
      } catch {
        abort('RDP 网关协议异常');
      }
    });
    socket.once('error', (error: NodeJS.ErrnoException) =>
      abort(`RDP 引擎连接失败（${error.code || '未知错误'}），请检查应用运行状态`),
    );
    socket.once('close', () => this.remove(item.id));
    const input = new GuacamoleParser((values) => {
      const op = values[0];
      if (op === '') {
        if (values[1] === 'ping') ws.send(instruction(...values));
        return;
      }
      if (
        !item.ready ||
        ![
          'sync',
          'mouse',
          'key',
          'size',
          'clipboard',
          'blob',
          'end',
          'ack',
          'disconnect',
          'nop',
        ].includes(op)
      )
        throw new Error('Disallowed client instruction');
      if (socket.writableLength > 1024 * 1024) throw new Error('Input overflow');
      socket.write(instruction(...values));
    });
    ws.on('message', (data, binary) => {
      try {
        if (binary) throw 0;
        input.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      } catch {
        abort('RDP 输入数据无效');
      }
    });
    ws.once('close', () => this.remove(item.id));
    ws.on('error', () => this.remove(item.id));
    item.alive = true;
    ws.on('pong', () => {
      item.alive = true;
    });
    item.heartbeat = setInterval(() => {
      if (!item.alive) {
        this.remove(item.id);
        ws.terminate();
        return;
      }
      item.alive = false;
      ws.ping();
    }, 15000);
    item.heartbeat.unref();
  }
  close() {
    if (this.server && this.upgrade) this.server.off('upgrade', this.upgrade);
    for (const id of this.sessions.keys()) this.remove(id);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.logs.clear();
  }
}
