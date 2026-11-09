/** Limits shared by normal mutations and configuration restore. */
export const CONFIG_LIMITS = {
  connections: 100,
  workspace: 1000,
  folderDepth: 16,
  tasks: 100,
  devices: 100,
  totalDevices: 500,
  providers: 20,
} as const;
