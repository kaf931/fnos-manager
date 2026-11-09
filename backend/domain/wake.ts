export interface DevicePresence {
  state: 'online' | 'offline' | 'unknown';
  checkedAt: string;
  reason: 'reply' | 'no_reply' | 'unavailable' | 'no_target';
}
export interface WakeDevice {
  ip?: string;
  presence?: DevicePresence;
  checking?: boolean;
  id: string;
  owner: string;
  name: string;
  mac: string;
  address: string;
  port: number;
  system: 'linux' | 'windows' | 'macos';
  connectionId: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastSentAt?: string;
  lastControl?: { action: 'reboot' | 'shutdown'; sentAt: string };
}
export interface PowerTarget {
  id: string;
  connectionId: string;
  system: WakeDevice['system'];
  host: string;
  port: number;
  username: string;
}
export type PowerAction = 'shutdown' | 'reboot';
export type DeviceResult =
  | { id: string; name: string; success: true; sentAt: string }
  | { id: string; name: string; success: false; error: string };
export interface WakeOptions {
  signal?: AbortSignal;
  scheduled?: boolean;
}
