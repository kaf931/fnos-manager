import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';
export function decodeVideoPacket(buffer: ArrayBuffer): ScrcpyMediaStreamPacket {
  const data = new Uint8Array(buffer);
  if (data.byteLength <= 10 || data.byteLength > 8 * 1024 * 1024 || data[0] > 1 || data[1] > 1)
    throw new Error('无效投屏视频帧');
  if (data[0] === 0) return { type: 'configuration', data: data.subarray(10) };
  return {
    type: 'data',
    keyframe: !!data[1],
    pts: new DataView(buffer).getBigUint64(2),
    data: data.subarray(10),
  };
}
export function screenPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return null;
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(((clientX - rect.left) * width) / rect.width))),
    y: Math.max(0, Math.min(height - 1, Math.floor(((clientY - rect.top) * height) / rect.height))),
  };
}
const keys: Record<string, number> = {
  Backspace: 67,
  Delete: 112,
  Enter: 66,
  Escape: 111,
  Tab: 61,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
};
export function androidKey(key: string): number | undefined {
  return keys[key];
}

export function fitScreen(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || availableWidth <= 0 || availableHeight <= 0)
    return { width: 0, height: 0 };
  const scale = Math.min(availableWidth / width, availableHeight / height, 1);
  return { width: width * scale, height: height * scale };
}
