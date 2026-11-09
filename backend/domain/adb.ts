export interface AdbConnection {
  id: string;
  ownerUid: string;
  name: string;
  protocol: 'adb';
  host: string;
  port: number;
  folderId: string | null;
  deviceType: 'network' | 'usb';
  serial: string;
}

/** Explicit scrcpy actions; never accept controller method names from clients. */
export const ADB_SCREEN_ACTIONS = ['display-off', 'display-on', 'rotate'] as const;
export type AdbScreenAction = (typeof ADB_SCREEN_ACTIONS)[number];

export const ADB_SCREEN_SIZES = [720, 1280, 1920, 0] as const;
export type AdbScreenSize = (typeof ADB_SCREEN_SIZES)[number];
