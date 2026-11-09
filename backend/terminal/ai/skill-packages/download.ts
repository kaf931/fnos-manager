import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { SKILL_PACKAGE_LIMITS } from '../../../domain/ai-skill-packages.js';
export function publicSkillAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split('.').map(Number),
      a = p[0]!,
      b = p[1]!;
    return (
      a > 0 &&
      a < 224 &&
      a !== 10 &&
      a !== 127 &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && (b === 168 || b === 0)) &&
      !(a === 198 && (b === 18 || b === 19))
    );
  }
  return isIP(ip) === 6 && /^[23]/i.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');
}
export async function downloadSkillZip(value: string, parent: AbortSignal): Promise<Buffer> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(20000)]);
  let url = new URL(value);
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw Error('请输入无凭据的 HTTPS ZIP 地址');
    const host = url.hostname.replace(/^\[|\]$/g, ''),
      addresses = await new Promise<import('node:dns').LookupAddress[]>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        lookup(host, { all: true })
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
      });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((a) => !publicSkillAddress(a.address)))
      throw Error('技能下载不能访问本机或私有网络');
    const chosen = addresses[0]!;
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(
        url,
        {
          signal,
          lookup: (_h, _o, cb) => cb(null, chosen.address, chosen.family),
          headers: { Accept: 'application/zip', 'User-Agent': 'nas-manager-skills' },
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
      response.resume();
      if (hop === 3 || !response.headers.location) throw Error('下载重定向超限');
      url = new URL(response.headers.location, url);
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw Error('技能下载失败：HTTP ' + response.statusCode);
    }
    if (Number(response.headers['content-length']) > SKILL_PACKAGE_LIMITS.zip) {
      response.destroy();
      throw Error('ZIP 不能超过 10 MiB');
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const part of response) {
      const chunk = Buffer.from(part as Uint8Array);
      size += chunk.length;
      if (size > SKILL_PACKAGE_LIMITS.zip) {
        response.destroy();
        throw Error('ZIP 不能超过 10 MiB');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('技能下载失败');
}
