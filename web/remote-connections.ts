import type { VncConnection } from '../backend/domain/vnc.js';
import type { Connection } from './contracts/terminal.js';
import type { ApiClient } from './contracts/shared.js';
export function connectionPath(connection: Pick<Connection, 'protocol'>) {
  return connection.protocol && connection.protocol !== 'ssh'
    ? '/' + connection.protocol + '/connections'
    : '/terminal/connections';
}
export async function loadConnections(api: ApiClient): Promise<Connection[]> {
  const [ssh, desktop, rdp, adb] = await Promise.all([
    api<Connection[]>('/terminal/connections'),
    api<Omit<VncConnection, 'ownerUid'>[]>('/vnc/connections'),
    api<Omit<import('../backend/domain/rdp.js').RdpConnection, 'ownerUid'>[]>('/rdp/connections'),
    api<Connection[]>('/adb/connections'),
  ]);
  return [
    ...ssh.map((c) => ({ ...c, protocol: 'ssh' as const })),
    ...adb.map((c) => ({
      ...c,
      transport: c.deviceType === 'usb' ? ('usb' as const) : ('tcp' as const),
      kind: 'remote' as const,
      authMethod: 'password' as const,
    })),
    ...[...desktop, ...rdp].map((c) => ({
      ...c,
      kind: 'remote' as const,
      authMethod: 'password' as const,
      credentials: { password: c.password },
      hasCredentials: !!c.password,
    })),
  ];
}

export function requiresSavedCredentials(
  connection: Pick<Connection, 'protocol' | 'hasCredentials'>,
) {
  return (
    connection.protocol !== 'vnc' && connection.protocol !== 'adb' && !connection.hasCredentials
  );
}
