import type { Connection } from './contracts/wake.js';
// Keep all saved SSH connections visible; local entries explain why they cannot control remote devices.
export function wakeConnectionOptions(connections: Connection[]) {
  return connections.map((c) => ({
    value: c.id,
    label: `${c.name} · ${c.username}@${c.host}:${c.port}${c.kind === 'local' ? '（本机，不用于远程设备）' : !c.hasCredentials ? '（待配置认证）' : ''}`,
    disabled: c.kind !== 'remote' || !c.hasCredentials,
  }));
}
export function wakeConnectionStatus(connections: Connection[], id: string) {
  const remote = connections.filter((c) => c.kind === 'remote');
  if (!remote.length) return '请先添加远程 SSH 连接。';
  if (!id) return '';
  const c = connections.find((c) => c.id === id);
  return c?.hasCredentials ? '' : '请先在远程连接保存认证信息。';
}
