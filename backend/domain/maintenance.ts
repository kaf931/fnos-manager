export const historyKinds = [
  'scans',
  'renames',
  'taskRuns',
  'operations',
  'deliveries',
  'restoreReceipts',
] as const;
export type HistoryKind = (typeof historyKinds)[number];
export const cleanupKinds = [
  ...historyKinds,
  'serviceLog',
  'aiHistory',
  'attachments',
  'updateCache',
] as const;
export type CleanupKind = (typeof cleanupKinds)[number];
export interface HistoryLimits {
  scans: number;
  renames: number;
  taskRuns: number;
  operations: number;
  deliveries: number;
  restoreReceipts: number;
  serviceLogMiB: number;
}
export const defaultHistoryLimits: Readonly<HistoryLimits> = {
  scans: 20,
  renames: 100,
  taskRuns: 100,
  operations: 1000,
  deliveries: 200,
  restoreReceipts: 1000,
  serviceLogMiB: 10,
};
export const cleanupLabels: Record<CleanupKind, string> = {
  scans: '扫描记录',
  renames: '改名记录',
  taskRuns: '任务运行记录',
  operations: '操作记录',
  deliveries: '投递记录',
  restoreReceipts: '配置恢复回执',
  serviceLog: '服务日志',
  aiHistory: 'AI 对话历史',
  attachments: '应用附件',
  updateCache: '更新缓存',
};
export interface CleanupSummary {
  items: { kind: CleanupKind; count: number; protected: number; bytes: number | null }[];
  limits: HistoryLimits;
}

export const maintenanceDetailKinds = [
  'taskRuns',
  'restoreReceipts',
  'serviceLog',
  'aiHistory',
  'updateCache',
] as const;
export type MaintenanceDetailKind = (typeof maintenanceDetailKinds)[number];
export interface MaintenanceRecord {
  id: string;
  name: string;
  status: string;
  createdAt: string | null;
  summary: string;
  bytes: number | null;
}
export interface MaintenanceRecordPage {
  items: MaintenanceRecord[];
  total: number;
  page: number;
  pageSize: number;
}
export interface MaintenanceRecordDetail {
  record: MaintenanceRecord;
  text: string;
  truncated: boolean;
  format?: 'markdown';
}

export const batchRecordKinds = [...maintenanceDetailKinds, 'operations', 'deliveries'] as const;
export type BatchRecordKind = (typeof batchRecordKinds)[number];
