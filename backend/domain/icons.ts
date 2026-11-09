export const menuPages = ['icons', 'tasks', 'terminal', 'storage', 'wake', 'settings'] as const;
export type MenuPage = (typeof menuPages)[number];
export interface IconEntry {
  id: string;
  name: string;
  url: string;
  mode: 'iframe' | 'url';
  containerId: string | null;
  menuPage?: MenuPage | null;
  iconSource: string;
  revision: number;
  appliedRevision: number;
  updatedAt?: string;
}
export interface OfficialConnection {
  connected: boolean;
  origin?: string;
  fileStorage?: boolean;
  pending?: number;
  authorizationUrl?: string;
}
