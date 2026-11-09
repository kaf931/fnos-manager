export type TransferStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface TransferInput {
  owner: string;
  sessionId: string;
  clientId?: string;
  connectionName: string;
  direction: 'upload' | 'download';
  path: string;
  size: number;
}
export interface TransferRecord {
  id: string;
  clientId?: string;
  connectionName: string;
  direction: 'upload' | 'download';
  path: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  queuedAt?: number;
  startedAt: number;
  finishedAt: number | null;
}
