import type { Worker } from 'node:worker_threads';
import type { RecordValue } from './record.js';
export interface ScanLimits {
  maxEntries?: number;
  maxHashBytes?: number;
  timeoutMs?: number;
  maxCatalogEntries?: number;
}
export interface ScanProgress {
  files: number;
  directories: number;
  bytes: number;
  hashedBytes: number;
}
export interface ScanFile {
  path: string;
  name: string;
  type: string;
  size: number;
  bytes: number;
  modifiedAt: number;
  extension: string;
}
export interface ScanEntry {
  name: string;
  path: string;
  type: string;
  bytes: number;
  files: number;
}
export interface ScanExtension {
  name: string;
  bytes: number;
  files: number;
}
export interface DuplicateGroup {
  size: number;
  paths: string[];
  count?: number;
  pathsTruncated?: boolean;
}
export interface ScanResult extends ScanProgress {
  skippedLinks: number;
  skippedHardLinks?: number;
  skippedMounts: number;
  errors: number;
  catalog: ScanFile[];
  catalogTruncated: boolean;
  largestFiles: ScanFile[];
  entries: ScanEntry[];
  extensions: ScanExtension[];
  groups: DuplicateGroup[];
  groupCount: number;
  reclaimable: number;
  truncated: boolean;
}
export interface DuplicateOutcome {
  path: string;
  keep: string;
  success: boolean;
  destination?: string | null;
  error?: string;
}
export interface DuplicateAction extends DuplicateOutcome {
  action: 'move' | 'delete';
  at: string;
}
export interface ScanJob extends RecordValue {
  id: string;
  owner: string;
  path: string;
  mode: 'space' | 'duplicates';
  status: string;
  result: ScanResult | null;
  progress: ScanProgress;
  worker?: Worker;
  duplicateActions?: DuplicateAction[];
  startedAt: string;
  finishedAt?: string;
  error?: string | null;
  persistenceError?: string;
}
export interface StorageContext {
  jobs: Map<string, ScanJob>;
  recordOperations: Set<string>;
  get(
    owner: string,
    id: string,
  ): Pick<ScanJob, 'mode' | 'result' | 'status' | 'path' | 'duplicateActions'>;
  resolve(target: unknown): Promise<string>;
  roots(): Promise<string[]>;
  persist(job?: ScanJob): Promise<void>;
}
export interface RenameRules {
  find?: string;
  replace?: string;
  prefix?: string;
  suffix?: string;
  baseName?: string;
  mode?: string;
  keepExtension?: boolean;
  start?: number | string;
  pad?: number | string;
  number?: boolean;
}
export interface FileFingerprint {
  dev: string;
  ino: string;
  size: string;
  mtime: string;
  ctime: string;
}
export interface RenameEntry {
  from: string;
  to: string;
  before?: FileFingerprint;
  after?: FileFingerprint;
  error?: string | null;
  unchanged: boolean;
  applied?: boolean;
  reverted?: boolean;
}
export interface RenamePlan {
  id?: string;
  owner?: string;
  path: string;
  directoryIdentity: string;
  entries: RenameEntry[];
  expiresAt?: number;
  conflicts?: number;
}
export interface RenamePreview extends RenamePlan {
  id: string;
  owner: string;
  expiresAt: number;
  conflicts: number;
}
export interface RenameSummary extends RecordValue {
  id: string;
  owner: string;
  path: string;
  directoryIdentity: string;
  mode: 'rename';
  operation: 'rename' | 'undo';
  undoOf?: string;
  undoneBy?: string;
  status: 'running' | 'interrupted' | 'completed' | 'partial' | 'failed';
  error: string | null;
  finishedAt?: string;
  changed: number;
  progress: { files: number; bytes: number };
  startedAt: string;
}

export interface RenameRecord extends RenameSummary {
  entries: RenameEntry[];
}
