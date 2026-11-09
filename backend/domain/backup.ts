/** Browser-safe configuration exchange contract. */
export const BACKUP_MODULES = [
  'icons',
  'tasks',
  'ssh',
  'commands',
  'wake',
  'ai',
  'preferences',
] as const;
export type BackupModule = (typeof BACKUP_MODULES)[number];
export type BackupKind =
  | 'icons'
  | 'folders'
  | 'connections'
  | 'vnc'
  | 'rdp'
  | 'adb'
  | 'shortcuts'
  | 'commands'
  | 'devices'
  | 'providers'
  | 'preferences'
  | 'tasks';
export interface BackupItem {
  kind: BackupKind;
  id: string;
  data: Record<string, unknown>;
}
export interface BackupPackage {
  format: 'fnos-manager-config';
  version: 1;
  exportedAt: string;
  appVersion: string;
  includeCredentials: boolean;
  items: BackupItem[];
}
export interface BackupDecision {
  key: string;
  action: 'skip' | 'import' | 'map';
  name?: string;
  targetId?: string;
}
export interface BackupPreviewRow {
  key: string;
  kind: BackupKind;
  id: string;
  name: string;
  conflict: boolean;
  defaultAction: 'skip' | 'import';
  dependencies: string[];
  candidates: { id: string; name: string }[];
  warnings: string[];
}
export interface BackupPreview {
  token: string;
  expiresAt: string;
  packageDigest: string;
  configDigest: string;
  counts: Record<string, number>;
  warnings: string[];
  rows: BackupPreviewRow[];
}
export interface RestoreResult {
  imported: number;
  skipped: number;
  mapped: number;
  requestId: string;
}
