import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScrcpyVideoDecoder } from '@yume-chan/scrcpy-decoder-tinyh264';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';
import type { ApiClient } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import { androidKey, decodeVideoPacket, screenPoint, fitScreen } from './adb-screen-protocol.js';
import { RemoteDesktopStatus } from './remote-desktop-surfaces.js';
import type { AdbScreenSize } from '../backend/domain/adb.js';
import { AdbControls } from './adb-controls.js';

export function AdbScreen({
  sessionId,
  api,
  active = true,
  onControls,
}: {
  sessionId: string;
  api: ApiClient;
  active?: boolean;
  onControls?: (controls: ReactNode | null) => void;
}) {
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    socket = useRef<WebSocket>();
  const dimensions = useRef({ width: 0, height: 0 }),
    pointer = useRef<number | null>(null);
  const [status, setStatus] = useState('正在连接…'),
    [failure, setFailure] = useState(false),
    [videoSize, setVideoSize] = useState({ width: 0, height: 0 }),
    [displaySize, setDisplaySize] = useState({ width: 0, height: 0 }),
    [ready, setReady] = useState(false),
    [software, setSoftware] = useState(false),
    [maxSize, setMaxSize] = useState<AdbScreenSize>(1280);
  const send = useCallback(
    (message: object) => {
      if (active && socket.current?.readyState === WebSocket.OPEN && ready)
        socket.current.send(JSON.stringify(message));
    },
    [active, ready],
  );
  useEffect(() => {
    if (!active) return;
    let disposed = false,
      failed = false,
      ws: WebSocket | undefined,
      decoder: ScrcpyVideoDecoder | undefined;
    let writer: ReturnType<ScrcpyVideoDecoder['writable']['getWriter']> | undefined;
    let queued = 0,
      chain = Promise.resolve(),
      firstFrameAt = 0,
      rendered = false;
    const monitor = setInterval(() => {
      if (disposed || failed || !firstFrameAt || !decoder) return;
      if (decoder.framesRendered > 0 && !rendered) {
        rendered = true;
        setStatus('');
      } else if (!rendered && Date.now() - firstFrameAt > 15_000) {
        firstFrameAt = 0;
        fail(new Error('15 秒内未能解码视频。请切换软件解码，或使用支持 WebCodecs 的浏览器'));
      }
    }, 500);
    const request = new AbortController();
    setReady(false);
    setFailure(false);
    setStatus('正在连接…');
    const fail = (error: unknown) => {
      if (!disposed && !failed) {
        failed = true;
        clearInterval(monitor);
        setReady(false);
        setFailure(true);
        setStatus(errorMessage(error, '投屏失败'));
        ws?.close();
        void writer?.abort().catch(() => {});
        decoder?.dispose();
      }
    };
    void (async () => {
      try {
        if (!canvas.current) return;
        if (!software && typeof VideoDecoder !== 'undefined') {
          const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
          if (disposed || !canvas.current) return;
          const element = canvas.current,
            context = element.getContext('2d', { alpha: false });
          if (!context) throw new Error('当前环境不支持画布渲染');
          decoder = new WebCodecsVideoDecoder({
            codec: ScrcpyVideoCodecId.H264,
            renderer: {
              setSize(width, height) {
                element.width = width;
                element.height = height;
              },
              draw(frame) {
                context.drawImage(frame, 0, 0);
              },
            },
          });
          setStatus('正在连接设备（WebCodecs）…');
        } else {
          const { TinyH264Decoder } = await import('@yume-chan/scrcpy-decoder-tinyh264');
          if (disposed || !canvas.current) return;
          decoder = new TinyH264Decoder({ canvas: canvas.current });
          setStatus('正在连接设备（软件解码）…');
        }
        decoder.sizeChanged((size) => {
          dimensions.current = size;
          setVideoSize(size);
        });
        writer = decoder.writable.getWriter();
        const { ticket } = await api<{ ticket: string }>(
          `/adb/sessions/${encodeURIComponent(sessionId)}/screen`,
          'POST',
          {},
          request.signal,
        );
        if (disposed) return;
        const url = new URL('/app/deskicons/adb/screen/ws', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('ticket', ticket);
        url.searchParams.set('maxSize', String(maxSize));
        ws = new WebSocket(url.href);
        socket.current = ws;
        ws.binaryType = 'arraybuffer';
        ws.addEventListener('message', (event) => {
          try {
            if (disposed || failed) return;
            if (typeof event.data === 'string') {
              const message = JSON.parse(event.data);
              if (message.type === 'error') {
                fail(new Error(message.message));
                return;
              }
              if (message.type === 'ready' || message.type === 'size') {
                if (
                  !Number.isInteger(message.width) ||
                  !Number.isInteger(message.height) ||
                  message.width <= 0 ||
                  message.height <= 0 ||
                  message.width > 8192 ||
                  message.height > 8192
                )
                  throw new Error('设备返回了无效视频尺寸');
                dimensions.current = { width: message.width, height: message.height };
                setVideoSize(dimensions.current);
                if (message.type === 'ready') {
                  setReady(true);
                  firstFrameAt = Date.now();
                  setStatus('设备已连接，等待解码首帧…');
                }
              }
              return;
            }
            const packet = decodeVideoPacket(event.data as ArrayBuffer);
            if (++queued > 90) throw new Error('解码速度不足，请降低投屏清晰度或重试软件解码');
            chain = chain
              .then(async () => {
                if (!disposed && !failed) await writer?.write(packet);
              })
              .catch(fail)
              .finally(() => {
                queued--;
              });
          } catch (error) {
            fail(error);
          }
        });
        ws.addEventListener('error', () => fail(new Error('投屏传输失败，请重新连接')));
        ws.addEventListener('close', () => {
          if (!disposed && !failed) {
            setReady(false);
            setFailure(true);
            setStatus('投屏连接已关闭');
          }
        });
      } catch (error) {
        if (!disposed) fail(error);
      }
    })();
    return () => {
      disposed = true;
      clearInterval(monitor);
      request.abort();
      ws?.close();
      socket.current = undefined;
      pointer.current = null;
      void writer?.abort().catch(() => {});
      decoder?.dispose();
      dimensions.current = { width: 0, height: 0 };
    };
  }, [sessionId, api, active, software, maxSize]);
  const touch = (event: React.PointerEvent<HTMLCanvasElement>, action: 0 | 1 | 2 | 3) => {
    if (!ready || !active || !canvas.current) return;
    if (action === 0) {
      if (pointer.current !== null) return;
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
    }
    if (pointer.current !== event.pointerId) return;
    const { width, height } = dimensions.current,
      point = screenPoint(
        event.clientX,
        event.clientY,
        canvas.current.getBoundingClientRect(),
        width,
        height,
      );
    if (point) send({ type: 'touch', action, ...point, width, height });
    if (action === 1 || action === 3) pointer.current = null;
    event.preventDefault();
  };
  useEffect(() => {
    const target = stage.current;
    if (!target) return;
    const resize = () =>
      setDisplaySize(
        fitScreen(videoSize.width, videoSize.height, target.clientWidth, target.clientHeight),
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(target);
    return () => observer.disconnect();
  }, [videoSize, active]);
  useEffect(() => {
    onControls?.(
      <AdbControls
        key="connected"
        ready={ready && active}
        software={software}
        maxSize={maxSize}
        onSize={setMaxSize}
        onKey={(keyCode) => send({ type: 'key', keyCode })}
        onAction={(action) => send({ type: 'action', action })}
        onSoftware={() => setSoftware((value) => !value)}
      />,
    );
    return () => onControls?.(null);
  }, [onControls, ready, active, software, maxSize, send]);
  return (
    <div className="remote-desktop-viewport">
      <div className="remote-desktop-stage" ref={stage}>
        <canvas
          key={`${software}:${maxSize}`}
          ref={canvas}
          tabIndex={0}
          aria-label="Android 投屏，点击触控并使用键盘"
          style={{ width: displaySize.width, height: displaySize.height }}
          onPointerDown={(e) => touch(e, 0)}
          onPointerMove={(e) => touch(e, 2)}
          onPointerUp={(e) => touch(e, 1)}
          onPointerCancel={(e) => touch(e, 3)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              !ready
            )
              return;
            const code = androidKey(event.key);
            if (code !== undefined) {
              event.preventDefault();
              send({ type: 'key', keyCode: code });
            } else if (event.key.length === 1) {
              event.preventDefault();
              send({ type: 'text', text: event.key });
            }
          }}
          onCompositionEnd={(event) => {
            if (event.data) send({ type: 'text', text: event.data });
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain');
            if (text && text.length <= 1024) {
              event.preventDefault();
              send({ type: 'text', text });
            }
          }}
        />
      </div>
      <RemoteDesktopStatus status={status} failure={failure} />
    </div>
  );
}
