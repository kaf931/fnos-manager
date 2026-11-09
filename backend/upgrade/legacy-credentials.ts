import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { record, text, type RecordValue } from '../persistence/records.js';
import { validateCredentials } from '../terminal/credentials.js';
/** Legacy decryption belongs exclusively to the offline upgrade tool. */
export function convertLegacyCredentials(row: RecordValue, keyPath: string): RecordValue {
  const { credentialBox, ...connection } = row;
  if (credentialBox == null) return connection;
  try {
    const box = record(credentialBox),
      key = readFileSync(keyPath);
    if (box.version !== 1 || key.length !== 32) throw new Error();
    const iv = Buffer.from(text(box.iv), 'base64'),
      tag = Buffer.from(text(box.tag), 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(
      Buffer.from(
        JSON.stringify([row.ownerUid, row.id, row.host, row.port, row.username, row.authMethod]),
      ),
    );
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(text(box.data), 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return { ...connection, credentials: validateCredentials(row.authMethod, JSON.parse(plain)) };
  } catch {
    throw new Error('旧 SSH 凭据转换失败，请检查原认证密钥');
  }
}
