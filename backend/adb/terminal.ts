import { AdbServerClient, type Adb } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { WebSocket } from 'ws';
import type { AdbSession, AdbSessions } from './service.js';
/** Shell v2 keeps terminal bytes and PTY resizing on separate protocol channels. */
export async function attachAdbTerminal(sessions: AdbSessions, session: AdbSession, ws: WebSocket) {
  ws.pause();
  let adb: Adb | undefined;
  let disposed = false;
  let pending = 0;
  let writes = Promise.resolve();
  let heartbeat: NodeJS.Timeout | undefined;
  let shell:
    Awaited<ReturnType<NonNullable<Adb['subprocess']['shellProtocol']>['pty']>> | undefined;
  const stop = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    session.disposers.delete(stop);
    if (ws.readyState === WebSocket.OPEN) ws.close();
    void Promise.resolve(shell?.kill()).catch(() => {});
    void adb?.close().catch(() => {});
  };
  session.disposers.add(stop);
  ws.once('close', stop);
  ws.once('error', stop);
  const timer = setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'ADB 终端启动超时');
    stop();
  }, 20000);
  timer.unref();
  try {
    const runtime = await sessions.runtime.owner(session.ownerUid);
    adb = await new AdbServerClient(
      new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: runtime.port }),
    ).createAdb({ serial: session.serial });
    if (disposed || session.abort.signal.aborted) {
      await adb.close();
      return;
    }
    const protocol = adb.subprocess.shellProtocol;
    if (!protocol?.isSupported) throw Error('此 Android 版本不支持交互式 Shell v2');
    shell = await protocol.pty({ terminalType: 'xterm-256color' });
    if (disposed) {
      await shell.kill();
      return;
    }
    clearTimeout(timer);
    const writer = shell.input.getWriter();
    await shell.resize(24, 80);
    let alive = true;
    ws.on('pong', () => {
      alive = true;
      session.touched = Date.now();
    });
    heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        stop();
        return;
      }
      alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 15000);
    heartbeat.unref();
    ws.on('message', (data, binary) => {
      session.touched = Date.now();
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      if (++pending > 128) {
        ws.close(1009, '终端输入过快');
        stop();
        return;
      }
      writes = writes
        .then(async () => {
          if (disposed) return;
          if (!binary) {
            try {
              const v = JSON.parse(buffer.toString());
              if (v.type === 'resize') {
                if (
                  !Number.isInteger(v.cols) ||
                  !Number.isInteger(v.rows) ||
                  v.cols < 2 ||
                  v.cols > 1000 ||
                  v.rows < 1 ||
                  v.rows > 1000
                )
                  throw Error('终端尺寸无效');
                await shell!.resize(v.rows, v.cols);
                return;
              }
            } catch (e) {
              if (buffer.toString().startsWith('{')) throw e;
            }
          }
          await writer.write(new Uint8Array(buffer));
        })
        .catch(() => {
          if (ws.readyState === WebSocket.OPEN) ws.close(1008, 'ADB 终端输入失败');
          stop();
        })
        .finally(() => {
          pending--;
        });
    });
    ws.resume();
    void shell.exited.then(stop, stop);
    const reader = shell.output.getReader();
    try {
      while (!disposed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (ws.readyState !== WebSocket.OPEN) break;
        if (ws.bufferedAmount > 4 * 1024 * 1024) throw Error('终端接收过慢');
        await new Promise<void>((resolve, reject) =>
          ws.send(value, { binary: true }, (e) => (e ? reject(e) : resolve())),
        );
      }
    } finally {
      reader.releaseLock();
      stop();
    }
  } catch {
    if (ws.readyState === WebSocket.OPEN)
      ws.close(1011, 'ADB 终端启动失败，请确认设备支持 Shell v2');
    stop();
  }
}
