import type { Socket } from 'node:net';
import { WebSocket } from 'ws';

/** Keep only one TCP chunk in flight; a slow browser applies TCP backpressure. */
export function createVncOutput(
  socket: Pick<Socket, 'pause' | 'resume' | 'destroyed'>,
  ws: Pick<WebSocket, 'readyState' | 'send' | 'bufferedAmount'>,
  abort: (reason: string) => void,
  now: () => number = Date.now,
) {
  let disposed = false;
  let sampledAt = now(),
    receivedBytes = 0,
    sentBytes = 0,
    peakBufferedBytes = 0,
    maxSendMs = 0;
  let sendingAt: number | undefined;
  const queued = () => ws.bufferedAmount || 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
  };
  const fail = (reason: string) => {
    if (disposed) return;
    dispose();
    abort(reason);
  };
  return {
    dispose,
    sample() {
      const time = now();
      const result = {
        intervalMs: Math.max(1, time - sampledAt),
        receivedBytes,
        sentBytes,
        bufferedBytes: queued(),
        peakBufferedBytes: Math.max(peakBufferedBytes, queued()),
        maxSendMs: Math.max(maxSendMs, sendingAt === undefined ? 0 : time - sendingAt),
      };
      sampledAt = time;
      receivedBytes = 0;
      sentBytes = 0;
      maxSendMs = 0;
      peakBufferedBytes = queued();
      return result;
    },
    send(chunk: Buffer) {
      if (disposed || ws.readyState !== WebSocket.OPEN) return;
      receivedBytes += chunk.length;
      sendingAt = now();
      peakBufferedBytes = Math.max(peakBufferedBytes, queued());
      socket.pause();
      timer = setTimeout(() => fail('客户端数据传输超时'), 30000);
      timer.unref();
      try {
        ws.send(chunk, { binary: true }, (error) => {
          clearTimeout(timer);
          if (disposed) return;
          if (sendingAt !== undefined) maxSendMs = Math.max(maxSendMs, now() - sendingAt);
          sendingAt = undefined;
          if (error) return fail('WebSocket 数据发送失败');
          sentBytes += chunk.length;
          if (!socket.destroyed && ws.readyState === WebSocket.OPEN) socket.resume();
        });
        peakBufferedBytes = Math.max(peakBufferedBytes, queued());
      } catch {
        fail('WebSocket 数据发送失败');
      }
    },
  };
}
