import type { TerminalConnection, WorkspaceItem } from '../../backend/domain/terminal.js';
import type {
  FileListingEntry,
  SessionState,
  TerminalEvent,
  NetworkSample,
  CpuSample,
  TextFileVersion,
} from '../../backend/domain/terminal-files.js';
export type {
  WorkspaceItem,
  SessionState,
  TerminalEvent,
  NetworkSample,
  CpuSample,
  TextFileVersion,
};
export interface Connection extends Omit<TerminalConnection, 'ownerUid' | 'credentials'> {
  protocol?: 'ssh' | 'vnc' | 'rdp' | 'adb';
  transport?: 'tcp' | 'usb';
  deviceType?: 'network' | 'usb';
  serial?: string;
  domain?: string;
  security?: import('../../backend/domain/rdp.js').RdpSecurity;
  certificatePolicy?: import('../../backend/domain/rdp.js').RdpCertificatePolicy;
  credentials?: { password?: string; privateKey?: string; passphrase?: string };
  hasCredentials?: boolean;
  selected?: boolean;
  busy?: boolean;
}
export interface SessionIdentity {
  id: string | null;
  generation: number;
  connected: boolean;
}
export type FileEntry = FileListingEntry;
export interface PathHistory {
  paths: string[];
  index: number;
}
export interface FileContext {
  session: SessionIdentity;
  path: string;
  sequence: number;
  entry?: FileEntry | null;
}
export type MonitorData = ReturnType<
  typeof import('../../backend/terminal/monitor.js').parseMonitor
>;
export type MonitorProcess = MonitorData['processes'][number];
export interface FileListing {
  path: string;
  entries: FileEntry[];
  files: number;
  directories: number;
}
export interface DirectorySize {
  bytes: number;
  files: number;
  directories: number;
}
export interface PositionedFileContext extends FileContext {
  x: number;
  y: number;
}
export interface FileSort {
  key: 'name' | 'type' | 'size' | 'mtime';
  desc: boolean;
}
export interface UploadProgress {
  name: string;
  percent: number;
}
export interface PermissionsInfo {
  mode: number;
  uid: number;
  gid: number;
}
export interface FileActionBody {
  path: string;
  name?: string;
  newName?: string;
  outputName?: string;
  format?: string;
  mode?: number;
}
export interface UploadOptions {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}
export interface FileSessionRefs {
  current: import('react').MutableRefObject<SessionIdentity>;
  directory: import('react').MutableRefObject<string | undefined>;
  seq: import('react').MutableRefObject<number>;
}
export type LoadDirectory = (
  path?: string,
  historyIndex?: number,
  options?: { fresh?: boolean },
) => Promise<void>;
export type FileAction = (
  kind: 'mkdir' | 'rename' | 'delete',
  entry?: FileEntry | null,
  source?: FileContext | null,
) => Promise<void>;
export type AdvancedFileAction = (
  kind: 'permissions' | 'compress' | 'extract',
  entry: FileEntry,
  source: FileContext,
) => Promise<void>;

export interface RemoteTextFile {
  content: string;
  encoding: string;
  bom: boolean;
  revision: string;
  size: number;
}
