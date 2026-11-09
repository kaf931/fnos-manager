import { isIP } from 'node:net';
import type { TerminalConnection } from '../domain/terminal.js';
import { DomainError, inputRecord } from '../errors.js';
export const fail = (message: string, status = 400) => new DomainError(message, status);
export function validateConnection(
  value: unknown,
): Pick<TerminalConnection, 'name' | 'kind' | 'host' | 'port' | 'username'> {
  const input = inputRecord(value);
  if (!input || (input.kind !== 'local' && input.kind !== 'remote')) throw fail('请选择连接类型');
  const name = String(input.name || '').trim(),
    username = String(input.username || '').trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name))
    throw fail('连接名称需为 1–80 个字符');
  if (!username || username.length > 128 || /[\x00-\x20\x7f]/.test(username))
    throw fail('请输入有效 SSH 用户名');
  const port = input.port === undefined || input.port === '' ? 22 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('SSH 端口需为 1–65535');
  let host =
    input.kind === 'local'
      ? '127.0.0.1'
      : String(input.host || '')
          .trim()
          .toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (
    !host ||
    host.length > 253 ||
    (!isIP(host) &&
      !host.split('.').every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(p)))
  )
    throw fail('请输入有效主机名或 IP 地址');
  return { name, kind: input.kind, host, port, username };
}
