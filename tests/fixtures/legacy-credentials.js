import { randomBytes, createCipheriv } from 'node:crypto';
export function sealLegacy(credentials, c, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(
    Buffer.from(JSON.stringify([c.ownerUid, c.id, c.host, c.port, c.username, c.authMethod])),
  );
  const data = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}
