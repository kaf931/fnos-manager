import type { WakeDevice, DeviceResult, PowerAction } from '../../backend/domain/wake.js';
import type { Connection } from './terminal.js';
import type { ApiClient, Toast } from './shared.js';
export type { WakeDevice, DeviceResult, PowerAction, Connection };
export interface WakeUiOptions {
  api: ApiClient;
  toast: Toast;
  esc?: (value: unknown) => string;
}
export interface WakeBatchResult {
  results: DeviceResult[];
  sent: number;
  failed: number;
}
export type PowerConfirmation = (
  action: PowerAction,
  targets: { name: string; connection: Connection }[],
) => Promise<boolean>;
