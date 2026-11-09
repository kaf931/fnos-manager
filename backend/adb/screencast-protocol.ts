import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';
import {
  ADB_SCREEN_SIZES,
  type AdbScreenSize,
  ADB_SCREEN_ACTIONS,
  type AdbScreenAction,
} from '../domain/adb.js';

/** A missing value preserves the existing stream; arbitrary encoder sizes are rejected. */
export function screenMaxSize(value: string | null): AdbScreenSize {
  if (value === null) return 1280;
  const size = ADB_SCREEN_SIZES.find((size) => String(size) === value);
  if (size === undefined) throw new Error('无效投屏清晰度');
  return size;
}

export type ScreenControl =
  | { type: 'touch'; action: 0 | 1 | 2 | 3; x: number; y: number; width: number; height: number }
  | { type: 'key'; keyCode: number }
  | { type: 'text'; text: string }
  | { type: 'action'; action: AdbScreenAction };
const allowedKeys = new Set([
  3, 4, 19, 20, 21, 22, 23, 24, 25, 26, 61, 62, 66, 67, 82, 92, 93, 111, 112, 122, 123, 124, 187,
  223, 224,
]);
export function validateScreenControl(value: unknown): ScreenControl {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('无效投屏控制消息');
  const m = value as Record<string, unknown>;
  if (
    m.type === 'action' &&
    typeof m.action === 'string' &&
    ADB_SCREEN_ACTIONS.includes(m.action as AdbScreenAction)
  )
    return { type: 'action', action: m.action as AdbScreenAction };
  if (m.type === 'key' && typeof m.keyCode === 'number' && allowedKeys.has(m.keyCode))
    return { type: 'key', keyCode: m.keyCode };
  if (
    m.type === 'text' &&
    typeof m.text === 'string' &&
    m.text.length > 0 &&
    m.text.length <= 1024 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(m.text)
  )
    return { type: 'text', text: m.text };
  if (
    m.type === 'touch' &&
    [0, 1, 2, 3].includes(m.action as number) &&
    ['x', 'y', 'width', 'height'].every((k) => Number.isInteger(m[k]))
  ) {
    const { x, y, width, height } = m as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    if (
      width > 0 &&
      height > 0 &&
      width <= 8192 &&
      height <= 8192 &&
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height
    )
      return { type: 'touch', action: m.action as 0 | 1 | 2 | 3, x, y, width, height };
  }
  throw new Error('无效投屏控制消息');
}
/** One WS binary message is one packet: kind:u8, keyframe:u8, pts:u64 BE, payload. */
export function encodeVideoPacket(packet: ScrcpyMediaStreamPacket): Uint8Array {
  const frame = new Uint8Array(10 + packet.data.byteLength);
  frame[0] = packet.type === 'configuration' ? 0 : 1;
  if (packet.type === 'data') {
    frame[1] = packet.keyframe ? 1 : 0;
    new DataView(frame.buffer).setBigUint64(2, packet.pts ?? 0n);
  }
  frame.set(packet.data, 10);
  return frame;
}
