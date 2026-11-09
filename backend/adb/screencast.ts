import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { AdbServerClient, type Adb } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_1 } from '@yume-chan/adb-scrcpy';
import type { AndroidKeyCode } from '@yume-chan/scrcpy';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';
import WebSocket from 'ws';
import type { AdbScreenSize } from '../domain/adb.js';
import { dispatchScreenAction } from './screencast-actions.js';
import { encodeVideoPacket, validateScreenControl } from './screencast-protocol.js';

type Client = AdbScrcpyClient<AdbScrcpyOptions3_1<true>>;
export interface ScreencastOptions {
  /** These values must come from the authenticated session, never client messages. */
  serial: string;
  serverPort: number;
  serverPath: string;
  maxSize?: AdbScreenSize;
  onClose?: () => void;
}
/** The caller authenticates/authorizes the session before upgrading the socket. */
export function attachAdbScreencast(
  ws: WebSocket,
  options: ScreencastOptions,
): () => Promise<void> {
  let disposed = false;
  let adb: Adb | undefined;
  let client: Client | undefined;
  let pending = 0;
  let windowStart = Date.now();
  let windowCount = 0;
  let controls = Promise.resolve();
  const abort = new AbortController();
  const send = (message: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const close = async () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    abort.abort();
    ws.removeListener('message', message);
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Screen closed');
    await client?.close().catch(() => {});
    await adb?.close().catch(() => {});
    options.onClose?.();
  };
  const fail = (error: unknown) => {
    if (disposed) return;
    // No shell output or connection credentials enter the response.
    const detail = error instanceof Error ? error.message : '未知错误';
    send({ type: 'error', message: `投屏失败：${detail.slice(0, 300)}` });
    void close();
  };
  const timer = setTimeout(
    () => fail(new Error('scrcpy 启动超过 20 秒，请检查设备屏幕授权及编码器')),
    20_000,
  );
  const message = (raw: WebSocket.RawData, binary: boolean) => {
    try {
      if (
        binary ||
        (Array.isArray(raw) ? raw.reduce((n, b) => n + b.byteLength, 0) : raw.byteLength) > 8192
      )
        throw new Error('投屏控制消息过大或格式错误');
      const command = validateScreenControl(JSON.parse(raw.toString()));
      if (Date.now() - windowStart >= 1000) {
        windowStart = Date.now();
        windowCount = 0;
      }
      if (++windowCount > 240 || pending >= 128) throw new Error('投屏控制消息过于频繁');
      if (!client?.controller) throw new Error('投屏尚未就绪');
      pending++;
      controls = controls
        .then(async () => {
          if (disposed || !client?.controller) return;
          const controller = client.controller;
          if (command.type === 'action') await dispatchScreenAction(controller, command.action);
          else if (command.type === 'text') await controller.injectText(command.text);
          else if (command.type === 'key') {
            await controller.injectKeyCode({
              action: 0,
              keyCode: command.keyCode as AndroidKeyCode,
              repeat: 0,
              metaState: 0,
            });
            await controller.injectKeyCode({
              action: 1,
              keyCode: command.keyCode as AndroidKeyCode,
              repeat: 0,
              metaState: 0,
            });
          } else
            await controller.injectTouch({
              action: command.action,
              pointerId: -2n,
              pointerX: command.x,
              pointerY: command.y,
              videoWidth: command.width,
              videoHeight: command.height,
              pressure: command.action === 1 || command.action === 3 ? 0 : 1,
              actionButton: 0,
              buttons: 0,
            });
        })
        .catch(fail)
        .finally(() => {
          pending--;
        });
    } catch (error) {
      fail(error);
    }
  };
  ws.on('message', message);
  ws.once('close', () => void close());
  ws.once('error', fail);
  void (async () => {
    const data = await readFile(options.serverPath).catch(() => {
      throw new Error('缺少 scrcpy 3.1 服务文件，请重新安装完整运行包');
    });
    if (disposed) return;
    const connection = await new AdbServerClient(
      new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: options.serverPort }),
    ).createAdb({ serial: options.serial });
    adb = connection;
    if (disposed) {
      await connection.close();
      return;
    }
    // Unique filename and socket prevent simultaneous screen sessions interfering.
    const token = randomBytes(4).readUInt32BE(0) & 0x7fffffff;
    const remote = `/data/local/tmp/deskicons-scrcpy-${token}.jar`;
    try {
      await AdbScrcpyClient.pushServer(
        connection,
        new ReadableStream({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        }),
        remote,
      );
      if (disposed) return;
      client = await AdbScrcpyClient.start(
        connection,
        remote,
        new AdbScrcpyOptions3_1({
          video: true,
          audio: false,
          control: true,
          tunnelForward: true,
          scid: token.toString(16),
          maxSize: options.maxSize ?? 1280,
          maxFps: 30,
          videoBitRate: 4_000_000,
          videoCodec: 'h264',
          videoCodecOptions: 'profile=1,level=256',
          clipboardAutosync: false,
          cleanup: true,
        }),
      );
      if (disposed) {
        await client.close();
        return;
      }
      // Drain server diagnostic output without retaining potentially sensitive content.
      void client.output
        .pipeTo(new WritableStream({ write() {} }), { signal: abort.signal })
        .catch(() => {});
      void client.exited.then(() => {
        if (!disposed) fail(new Error('设备 scrcpy 服务已结束'));
      }, fail);
      const video = await client.videoStream;
      if (disposed) return;
      // Width/height stay zero until the first codec configuration is consumed.
      // Announce readiness from the parsed SPS event, before forwarding that packet.
      let announced = false;
      video.sizeChanged((size) => {
        clearTimeout(timer);
        send({ type: announced ? 'size' : 'ready', codec: video.metadata.codec, ...size });
        announced = true;
      });
      const reader = video.stream.getReader();
      try {
        while (!disposed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ws.bufferedAmount > 4 * 1024 * 1024)
            throw new Error('网络或解码速度不足，请重新打开投屏');
          if (ws.readyState === WebSocket.OPEN) ws.send(encodeVideoPacket(value));
        }
      } finally {
        reader.releaseLock();
      }
      await close();
    } finally {
      // scrcpy's cleanup removes its server file; also remove if startup failed.
      await adb?.rm(remote, { force: true }).catch(() => {});
    }
  })().catch(fail);
  return close;
}
