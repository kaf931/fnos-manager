import type {
  Schedule,
  TaskRecord as StoredTask,
  TaskRun as StoredRun,
  TaskType,
} from '../../backend/domain/tasks.js';
import type { PowerTarget } from '../../backend/domain/wake.js';
export type { Schedule, TaskType };
export type TaskRun = Pick<
  StoredRun,
  | 'id'
  | 'taskId'
  | 'taskName'
  | 'trigger'
  | 'status'
  | 'startedAt'
  | 'finishedAt'
  | 'code'
  | 'stdout'
  | 'stderr'
  | 'truncated'
>;
export type TaskRecord = Pick<
  StoredTask,
  | 'id'
  | 'name'
  | 'type'
  | 'enabled'
  | 'schedule'
  | 'timeoutSeconds'
  | 'retryCount'
  | 'missedPolicy'
  | 'action'
  | 'target'
  | 'script'
  | 'level'
  | 'module'
  | 'acknowledged'
  | 'deviceIds'
  | 'deviceTargets'
  | 'nextRunAt'
  | 'pendingReason'
  | 'updatedAt'
> & { running: boolean; lastRun: TaskRun | null };
export interface TaskTypeInfo {
  id: TaskType;
  name: string;
  group: string;
  method?: string;
  support: 'device' | 'native' | 'oauth' | 'unavailable' | 'script';
  notice?: string;
  dangerous?: boolean;
  available: boolean;
  ready: boolean;
}
export interface OfficialStatus {
  installed: boolean;
  connected: boolean;
  origin?: string;
  fileStorage?: boolean;
  authorizationUrl?: string;
}
export interface TaskCapabilities {
  timezone: string;
  native: boolean;
  connection: OfficialStatus;
  types: TaskTypeInfo[];
}
export interface DeviceOption {
  id: string;
  name: string;
  mac: string;
  available: boolean;
  description: string;
  target?: PowerTarget;
}
export type TaskAction = 'run' | 'edit' | 'history' | 'toggle' | 'delete';
