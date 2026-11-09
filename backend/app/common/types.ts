import type { Request } from 'express';
export interface ApiRequest extends Request {
  params: Record<string, string>;
  terminalOwner: string;
  storageOwner: string;
}
export interface AppOptions {
  dataDir: string;
  root: string;
  gateway: boolean;
  startScheduler: boolean;
  csrfToken: string;
  version: string;
  storageRoots?: string[];
  storageLimits?: Record<string, number>;
}
export const APP_OPTIONS = Symbol('APP_OPTIONS');
