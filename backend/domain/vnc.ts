export interface VncConnection {
  id: string;
  ownerUid: string;
  name: string;
  protocol: 'vnc';
  host: string;
  port: number;
  username: string;
  password: string;
  folderId: string | null;
}
export type VncLogStage =
  | 'session'
  | 'websocket'
  | 'network'
  | 'protocol'
  | 'auth'
  | 'desktop'
  | 'performance'
  | 'disconnect';
export type VncLogLevel = 'info' | 'success' | 'error';
export interface VncLogEntry {
  id: number;
  time: string;
  elapsedMs: number;
  stage: VncLogStage;
  level: VncLogLevel;
  message: string;
}

/** Native noVNC preferences stored separately from connection credentials. */
export interface VncSettings {
  shared: boolean;
  viewOnly: boolean;
  clipViewport: boolean;
  scaleMode: 'off' | 'scale' | 'remote';
  qualityLevel: number;
  compressionLevel: number;
  cursorMode: 'local' | 'remote';
  showDotCursor: boolean;
  autoReconnect: boolean;
  reconnectDelay: number;
  repeaterId: string;
  logging: 'error' | 'warn' | 'info' | 'debug';
}
export const DEFAULT_VNC_SETTINGS: Readonly<VncSettings> = Object.freeze({
  shared: true,
  viewOnly: false,
  clipViewport: false,
  scaleMode: 'scale',
  qualityLevel: 6,
  compressionLevel: 2,
  cursorMode: 'remote',
  showDotCursor: true,
  autoReconnect: false,
  reconnectDelay: 5000,
  repeaterId: '',
  logging: 'warn',
});
