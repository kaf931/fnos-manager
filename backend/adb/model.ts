import { isIP } from 'node:net';
import { inputRecord } from '../errors.js';
import { fail } from '../terminal/model.js';
import type { AdbConnection } from '../domain/adb.js';
export function validateAdbConnection(input: unknown): Omit<AdbConnection, 'id' | 'ownerUid'> {
  const v = inputRecord(input);
  const name = String(v.name ?? '').trim(),
    host = String(v.host ?? '')
      .trim()
      .replace(/^\[|\]$/g, ''),
    deviceType = v.deviceType ?? (v.transport === 'usb' ? 'usb' : 'network'),
    serial = String(v.serial ?? '');
  if (v.protocol !== 'adb' || !name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name))
    throw fail('ADB 连接名称无效');
  if (!['network', 'usb'].includes(String(deviceType))) throw fail('ADB 连接方式无效');
  if (
    deviceType === 'network' &&
    (!host ||
      host.length > 253 ||
      (!isIP(host) &&
        !host.split('.').every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p))))
  )
    throw fail('请输入有效主机地址');
  const port = v.port ?? 5555;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw fail('ADB 端口需为 1–65535');
  if (deviceType === 'usb' && !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(serial))
    throw fail('USB 序列号无效');
  if (
    v.folderId != null &&
    (typeof v.folderId !== 'string' || !/^[-a-zA-Z0-9_]{1,80}$/.test(v.folderId))
  )
    throw fail('目录无效');
  return {
    name,
    protocol: 'adb',
    host,
    port,
    deviceType: deviceType as 'network' | 'usb',
    serial,
    folderId: (v.folderId as string | null) ?? null,
  };
}
export function remotePath(v: unknown) {
  if (
    typeof v !== 'string' ||
    !v.startsWith('/') ||
    v.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(v) ||
    v.split('/').some((p) => p === '..')
  )
    throw fail('设备路径无效');
  return v;
}
// ADB shell transports commands through Android's shell: quote each pathname separately.
export function quoteRemoteArg(v: string) {
  return "'" + v.replace(/'/g, "'\\''") + "'";
}
