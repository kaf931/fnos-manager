import { isIP } from 'node:net';
import { inputRecord } from '../errors.js';
import { fail } from '../terminal/model.js';
import type { VncConnection } from '../domain/vnc.js';
export function validateVncConnection(value: unknown): Omit<VncConnection, 'id' | 'ownerUid'> {
  const v = inputRecord(value);
  if (!v || v.protocol !== 'vnc') throw fail('请选择 VNC 协议');
  function text(key: string, max: number) {
    const value = v![key] ?? '';
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value))
      throw fail('连接字段格式不正确');
    return value;
  }
  const name = text('name', 80).trim(),
    host = text('host', 253)
      .trim()
      .replace(/^\[|\]$/g, '');
  if (
    !name ||
    !host ||
    (!isIP(host) &&
      !host.split('.').every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p)))
  )
    throw fail('请输入有效名称及主机地址');
  const port = v.port ?? 5900;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw fail('端口需为 1–65535');
  const username = text('username', 128),
    password = text('password', 4096);
  if (
    v.folderId != null &&
    (typeof v.folderId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.folderId))
  )
    throw fail('目录无效');
  return {
    name,
    protocol: 'vnc',
    host,
    port,
    username,
    password,
    folderId: (v.folderId as string | null) ?? null,
  };
}
