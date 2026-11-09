import type { RecordValue } from './record.js';
import type { PowerTarget } from './wake.js';
export type TaskType =
  | 'device-wake'
  | 'device-reboot'
  | 'device-shutdown'
  | 'app'
  | 'docker'
  | 'reboot'
  | 'trash-clear'
  | 'log-clear'
  | 'cache-clear'
  | 'backup'
  | 'snapshot'
  | 'script';
export type Schedule =
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; days: number[] }
  | { kind: 'interval'; minutes: number }
  | { kind: 'once'; at: string };
export interface TaskDefinition extends RecordValue {
  name: string;
  type: TaskType;
  ownerUid?: string;
  enabled: boolean;
  schedule: Schedule;
  timeoutSeconds: number;
  retryCount?: number;
  missedPolicy?: 'skip' | 'once';
  action?: 'start' | 'stop' | 'restart';
  target?: string;
  script?: string;
  level?: number;
  module?: number;
  acknowledged?: boolean;
  deviceIds?: string[];
  deviceTargets?: PowerTarget[];
}
export interface TaskRecord extends TaskDefinition {
  id: string;
  nextRunAt: string | null;
  pendingReason?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface TaskRun extends RecordValue {
  id: string;
  taskId: string;
  taskName: string;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'success' | 'failed' | 'timeout' | 'interrupted';
  startedAt: string;
  finishedAt?: string;
  code?: number;
  stdout: string;
  stderr: string;
  truncated?: boolean;
  deviceResults?: unknown[];
}
export interface PageOptions {
  page: number;
  pageSize: number;
}
export interface Page<T> extends PageOptions {
  items: T[];
  total: number;
}
