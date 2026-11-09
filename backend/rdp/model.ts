import { isIP } from 'node:net';
import { inputRecord } from '../errors.js';
import { fail } from '../terminal/model.js';
import {
  RDP_SECURITY_MODES,
  RDP_CERTIFICATE_POLICIES,
  type RdpSecurity,
  type RdpCertificatePolicy,
} from '../domain/rdp.js';
import type { RdpConnection } from '../domain/rdp.js';
export function validateRdpConnection(value: unknown): Omit<RdpConnection, 'id' | 'ownerUid'> {
  const v = inputRecord(value);
  if (!v || v.protocol !== 'rdp') throw fail('请选择 RDP 协议');
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
  const port = v.port ?? 3389;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw fail('端口需为 1–65535');
  const username = text('username', 128),
    password = text('password', 4096);
  const domain = text('domain', 253);
  if (!username) throw fail('请输入用户名');
  if (
    v.folderId != null &&
    (typeof v.folderId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.folderId))
  )
    throw fail('目录无效');
  const security = v.security ?? 'any',
    certificatePolicy = v.certificatePolicy ?? 'strict';
  if (!RDP_SECURITY_MODES.includes(security as RdpSecurity)) throw fail('安全模式无效');
  if (!RDP_CERTIFICATE_POLICIES.includes(certificatePolicy as RdpCertificatePolicy))
    throw fail('证书策略无效');
  return {
    name,
    protocol: 'rdp',
    host,
    port,
    username,
    password,
    domain,
    security: security as RdpSecurity,
    certificatePolicy: certificatePolicy as RdpCertificatePolicy,
    folderId: (v.folderId as string | null) ?? null,
  };
}
