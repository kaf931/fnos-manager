import ssh2 from 'ssh2';
import type { Credentials } from '../domain/terminal.js';
import { inputRecord } from '../errors.js';
import { fail } from './model.js';
export function validateCredentials(method: unknown, value: unknown): Credentials {
  const input = inputRecord(value, '请填写认证信息');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('请填写认证信息');
  if (method === 'password') {
    if (typeof input.password !== 'string' || !input.password || input.password.length > 4096)
      throw fail('请输入有效密码');
    return { method, password: input.password };
  }
  if (method === 'privateKey') {
    if (
      typeof input.privateKey !== 'string' ||
      !input.privateKey ||
      input.privateKey.length > 65536 ||
      (input.passphrase !== undefined && typeof input.passphrase !== 'string') ||
      (typeof input.passphrase === 'string' && input.passphrase.length > 4096)
    )
      throw fail('请输入有效私钥和口令');
    const parsed = ssh2.utils.parseKey(
      input.privateKey,
      typeof input.passphrase === 'string' ? input.passphrase : undefined,
    );
    if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
      throw fail('私钥格式或口令不正确');
    return {
      method,
      privateKey: input.privateKey,
      passphrase: typeof input.passphrase === 'string' ? input.passphrase : '',
    };
  }
  throw fail('请选择密码或私钥认证');
}
