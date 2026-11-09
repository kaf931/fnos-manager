import type { Attributes, FileEntryWithStats, Stats } from 'ssh2';
export interface SftpOperations {
  realpath: { args: [string]; result: string };
  lstat: { args: [string]; result: Stats };
  stat: { args: [string]; result: Stats };
  fstat: { args: [Buffer]; result: Stats };
  fsetstat: { args: [Buffer, Partial<Attributes>]; result: void };
  ext_openssh_rename: { args: [string, string]; result: void };
  opendir: { args: [string]; result: Buffer };
  readdir: { args: [Buffer]; result: FileEntryWithStats[] | false };
  close: { args: [Buffer]; result: void };
  mkdir: { args: [string, Partial<Attributes>]; result: void };
  rename: { args: [string, string]; result: void };
  rmdir: { args: [string]; result: void };
  unlink: { args: [string]; result: void };
  open: { args: [string, string, Partial<Attributes>?]; result: Buffer };
  read: { args: [Buffer, Buffer, number, number, number]; result: number };
  write: { args: [Buffer, Buffer, number, number, number]; result: void };
}
export interface FileListingEntry {
  name: string;
  type: 'directory' | 'link' | 'file' | 'other';
  size: number;
  mtime: number;
}
export type ArchiveRequest =
  | { action: 'chmod'; path: string; name: string; mode: number }
  | {
      action: 'compress' | 'extract';
      path: string;
      name: string;
      outputName: string;
      format?: string;
    };
export type ArchiveResult = { name: string; entries: number } | { mode: number };
export interface CpuSample {
  total: number;
  idle: number;
  percent?: number | null;
  cores?: CoreSample[];
}
export interface CoreSample extends CpuSample {
  id: number;
}
export interface NetworkSample {
  name: string;
  physical?: boolean;
  state?: string;
  received: number;
  transmitted: number;
  addresses: string[];
  receiveRate: number | null;
  transmitRate: number | null;
}
export interface MonitorPrevious {
  cpu?: CpuSample;
  total?: number;
  idle?: number;
  cores?: CoreSample[];
  network?: NetworkSample[];
  sampledAt?: number;
}
export type SessionState =
  | 'pending'
  | 'connecting'
  | 'host-key'
  | 'credentials'
  | 'authenticating'
  | 'connected'
  | 'disconnected';
export type ConnectionStage = 'network' | 'handshake' | 'fingerprint' | 'authentication' | 'sftp';
export type ConnectionDiagnostic = {
  type: 'diagnostic';
  stage: ConnectionStage;
  status: 'running' | 'waiting' | 'passed' | 'failed';
  message: string;
  at: number;
};
export type TerminalEvent =
  | ConnectionDiagnostic
  | { type: 'state'; state: SessionState }
  | { type: 'error'; code: string; message: string }
  | { type: 'output'; data: string; seq?: number }
  | { type: 'credentials-required' }
  | {
      type: 'host-key';
      host: string;
      port: number;
      algorithm: string;
      fingerprint: string;
      changed: boolean;
      previousFingerprints: string[];
    };

/** Public local checkpoint metadata; contains no SSH credentials or local paths. */
export interface TextFileVersion {
  id: string;
  createdAt: string;
  size: number;
  encoding: string;
  bom: boolean;
}
