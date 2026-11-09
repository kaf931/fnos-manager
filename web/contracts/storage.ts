import type {
  DuplicateAction,
  DuplicateGroup,
  DuplicateOutcome,
  RenameEntry,
  RenameRules as DomainRenameRules,
  ScanEntry,
  ScanFile,
  ScanProgress,
  ScanResult,
} from '../../backend/domain/storage.js';
export type { DuplicateGroup, DuplicateOutcome, ScanEntry, ScanFile, ScanProgress, ScanResult };
export type RenameRules = Omit<DomainRenameRules, 'mode' | 'start' | 'pad'> & {
  mode?: 'rules' | 'unified';
  start?: number;
  pad?: number;
};
export type ScanMode = 'space' | 'duplicates';
export type StorageMode =
  | ScanMode
  | 'rename'
  | 'scan-history'
  | 'rename-history'
  | 'attachments'
  | 'operations'
  | 'deliveries'
  | 'cleanup'
  | 'task-runs'
  | 'restore-receipts'
  | 'update-cache'
  | 'service-log'
  | 'ai-chats';
export type ScanStage = 'progress' | 'details';
export type ScanView = 'files' | 'large' | 'directories';
export type ScanSort = 'name' | 'size' | 'modified';
export interface ScanRecord {
  id: string;
  path: string;
  mode: ScanMode;
  status: string;
  result?: Partial<ScanResult> | null;
  progress: Partial<ScanProgress>;
  duplicateActions?: DuplicateAction[];
  startedAt: string;
  finishedAt?: string;
  createdAt?: string;
  error?: string | null;
  persistenceError?: string;
  capacity?: {
    volumePath: string;
    scopePath: string;
    total: number;
    available: number;
    used: number;
  } | null;
}
export interface RenameFile {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
}
export interface RenameRecord {
  id: string;
  path: string;
  mode: 'rename';
  operation: 'rename' | 'undo';
  status: string;
  entries: Pick<RenameEntry, 'from' | 'to' | 'applied'>[];
  changed: number;
  undoneBy?: string;
  error?: string | null;
  startedAt: string;
  finishedAt?: string;
  progress: { files: number; bytes: number };
}
export interface RenamePreview {
  id: string;
  entries: Pick<RenameEntry, 'from' | 'to' | 'error' | 'unchanged'>[];
  changed: number;
  conflicts: number;
}
export type HistoryRecord = ScanRecord | RenameRecord;
export type HistorySummary = Pick<
  HistoryRecord,
  'id' | 'path' | 'mode' | 'status' | 'progress' | 'startedAt' | 'error'
> & { operation?: 'rename' | 'undo' };

export interface StoragePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface DirectoryListing {
  path: string | null;
  parent: string | null;
  items: { name: string; path: string }[];
  truncated?: boolean;
}
export interface RenameListing {
  items: RenameFile[];
  truncated?: boolean;
}
export interface DuplicatePlanEntry {
  keep: string;
  path: string;
  size: number;
}
export interface IndexedDuplicateGroup extends DuplicateGroup {
  index: number;
}
export interface StorageHistoryHandle {
  (): void;
  hide(): void;
  refresh(): Promise<void>;
  toggleManagement(): void;
  selectionCount(): number;
}
export interface DuplicateProcessRequest {
  action: 'move' | 'delete';
  destination?: string;
  confirmed: true;
  items: { keep: string; path: string }[];
}

export interface ScanComparison {
  before: { id: string; path: string; complete: boolean };
  after: { id: string; path: string; complete: boolean };
  directoryComplete: boolean;
  counts: Record<string, number>;
  warning: string;
  page: number;
  pageSize: number;
  total: number;
  items: {
    path: string;
    kind: string;
    beforeSize: number | null;
    afterSize: number | null;
    delta: number | null;
    uncertain: boolean;
  }[];
}
