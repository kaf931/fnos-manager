export type Credentials =
  | { method: 'password'; password: string }
  | { method: 'privateKey'; privateKey: string; passphrase: string };
export interface TerminalConnection {
  id: string;
  ownerUid: string;
  name: string;
  kind: 'local' | 'remote';
  host: string;
  port: number;
  username: string;
  authMethod?: 'password' | 'privateKey';
  credentials?: Credentials;
  folderId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface HostKey {
  ownerUid: string;
  host: string;
  port: number;
  algorithm: string;
  key: string;
  fingerprint: string;
}
export interface WorkspaceFolder {
  id: string;
  ownerUid: string;
  name: string;
  kind: 'folder';
  scope: 'assets' | 'commands';
  parentId: string | null;
}
export interface WorkspaceCommand {
  id: string;
  ownerUid: string;
  name: string;
  kind: 'command';
  scope: 'commands';
  parentId: string | null;
  content: string;
}
export type WorkspaceItem = WorkspaceFolder | WorkspaceCommand;

/** Decode persisted credentials without trusting JSON field types. */
export function decodeStoredCredentials(method: unknown, value: unknown): Credentials {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('SSH 凭据格式无效');
  const input = value as Record<string, unknown>;
  if (input.method !== method) throw new Error('SSH 认证方式与凭据不一致');
  if (
    method === 'password' &&
    typeof input.password === 'string' &&
    input.password.length > 0 &&
    input.password.length <= 4096
  )
    return { method, password: input.password };
  if (
    method === 'privateKey' &&
    typeof input.privateKey === 'string' &&
    input.privateKey.length > 0 &&
    input.privateKey.length <= 65536 &&
    typeof input.passphrase === 'string' &&
    input.passphrase.length <= 4096
  )
    return { method, privateKey: input.privateKey, passphrase: input.passphrase };
  throw new Error('SSH 凭据格式无效');
}
