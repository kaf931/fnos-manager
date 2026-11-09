export const operationActions = [
  'ssh.delete',
  'ssh.rename',
  'storage.rename',
  'storage.undo',
  'storage.duplicates.delete',
  'storage.duplicates.move',
  'backup.restore',
  'device.reboot',
  'device.shutdown',
  'ai.command',
  'ai.skill',
] as const;
export const operationStatuses = [
  'running',
  'success',
  'partial',
  'failed',
  'interrupted',
] as const;
export type OperationAction = (typeof operationActions)[number];
export type OperationStatus = (typeof operationStatuses)[number];
export type OperationRetention = number;
export interface OperationRecord {
  id: string;
  ownerUid: string;
  action: OperationAction;
  target: string;
  status: OperationStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
}
export interface OperationPage {
  items: OperationRecord[];
  total: number;
  page: number;
  pageSize: number;
}
