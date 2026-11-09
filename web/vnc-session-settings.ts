import type VncClient from './vnc-client.js';
import type { VncSettings } from '../backend/domain/vnc.js';
export function applyVncSettings(
  client: VncClient,
  settings: VncSettings,
  visible: boolean,
  dragging: boolean,
) {
  client.scaleViewport = settings.scaleMode === 'scale';
  client.resizeSession = settings.scaleMode === 'remote';
  client.clipViewport = settings.scaleMode === 'off' && settings.clipViewport;
  client.dragViewport = client.clipViewport && dragging;
  client.setViewOnly(!visible || settings.viewOnly);
  client.qualityLevel = settings.qualityLevel;
  client.compressionLevel = settings.compressionLevel;
  client.showDotCursor = settings.showDotCursor;
}
