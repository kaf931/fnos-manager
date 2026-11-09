import { UPDATE_MIRROR_ORIGIN } from './routes.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import type { UpdateSpec } from './job.js';
export type DownloadRoute = 'direct' | 'mirror';
const mirrorOrigin = UPDATE_MIRROR_ORIGIN;
const mirrorPrefix = '/https://github.com/kaf931/fnos-manager/releases/download/';
const allowed = (url: URL, route: DownloadRoute) =>
  url.protocol === 'https:' &&
  !url.username &&
  !url.password &&
  (!url.port || url.port === '443') &&
  (['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
    url.hostname,
  ) ||
    (route === 'mirror' && url.origin === mirrorOrigin && url.pathname.startsWith(mirrorPrefix)));
interface ResumeMetadata {
  url: string;
  size: number;
  sha256: string;
  etag?: string;
  modified?: string;
}
const same = (a: ResumeMetadata, b: UpdateSpec['asset']) =>
  a.url === b.url && a.size === b.size && a.sha256 === b.sha256;
async function metadata(file: string): Promise<ResumeMetadata | null> {
  try {
    return JSON.parse(await readFile(file + '.resume.json', 'utf8'));
  } catch {
    return null;
  }
}
async function saveMetadata(file: string, value: ResumeMetadata) {
  await writeFile(file + '.resume.json.tmp', JSON.stringify(value), { mode: 0o600 });
  await rename(file + '.resume.json.tmp', file + '.resume.json');
}
async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
/** Move an eligible partial into a fresh task before the previous task is cleaned up. */
export async function carryDownload(
  previous: string,
  next: string,
  asset: UpdateSpec['asset'],
): Promise<number> {
  const info = await metadata(previous);
  if (!info || !same(info, asset)) return 0;
  try {
    const size = (await stat(previous)).size;
    if (size > asset.size) return 0;
    await rename(previous, next);
    await rename(previous + '.resume.json', next + '.resume.json');
    return size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw e;
  }
}
export async function downloadPackage(
  asset: UpdateSpec['asset'],
  file: string,
  progress: (received: number) => Promise<void>,
  request: typeof fetch = fetch,
  route: DownloadRoute = 'direct',
): Promise<void> {
  if (
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 512 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(asset.sha256)
  )
    throw new Error('安装包大小或校验信息无效');
  if (!asset.url.startsWith('https://github.com/kaf931/fnos-manager/releases/download/'))
    throw new Error('安装包来源无效');
  let info = await metadata(file),
    offset = 0;
  try {
    offset = (await stat(file)).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (!info || !same(info, asset) || offset > asset.size) {
    await rm(file, { force: true });
    offset = 0;
    info = null;
  }
  if (offset === asset.size) {
    if ((await hashFile(file)) === asset.sha256) {
      await progress(offset);
      return;
    }
    await rm(file, { force: true });
    offset = 0;
    info = null;
  }
  await progress(offset);
  const signal = AbortSignal.timeout(10 * 60 * 1000);
  // One fallback is allowed when a server rejects a stale Range or changes the entity.
  for (let attempt = 0; attempt < 2; attempt++) {
    let url = new URL(route === 'mirror' ? mirrorOrigin + '/' + asset.url : asset.url),
      response: Response | undefined;
    const headers: Record<string, string> = {
      'User-Agent': 'fnos-manager-updater',
      'Accept-Encoding': 'identity',
    };
    if (offset > 0) {
      headers.Range = `bytes=${offset}-`;
      const validator = info?.etag || info?.modified;
      if (validator) headers['If-Range'] = validator;
    }
    for (let redirects = 0; redirects < 6; redirects++) {
      if (!allowed(url, route)) throw new Error('安装包重定向地址无效');
      response = await request(url, { redirect: 'manual', signal, headers });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('安装包下载地址无效');
        url = new URL(location, url);
        response = undefined;
        continue;
      }
      break;
    }
    if (response?.status === 416 && offset > 0) {
      await response.body?.cancel();
      await rm(file, { force: true });
      offset = 0;
      info = null;
      await progress(0);
      continue;
    }
    if (!response?.ok || !response.body) {
      const status = response?.status;
      await response?.body?.cancel();
      if (status === 408 || status === 429 || (status && status >= 500))
        throw new TemporaryDownloadError(`下载服务器暂时不可用（HTTP ${status}）`);
      throw new Error(`安装包下载失败${status ? `（HTTP ${status}）` : ''}`);
    }
    const etag = response.headers.get('etag'),
      modified = response.headers.get('last-modified');
    if (
      offset > 0 &&
      response.status === 206 &&
      ((info?.etag && etag && info.etag !== etag) ||
        (!info?.etag && info?.modified && modified && info.modified !== modified))
    ) {
      await response.body.cancel();
      await rm(file, { force: true });
      offset = 0;
      info = null;
      await progress(0);
      continue;
    }
    if (response.status === 200 && offset > 0) {
      offset = 0;
      await progress(0);
    }
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (
        !range ||
        Number(range[1]) !== offset ||
        Number(range[2]) !== asset.size - 1 ||
        Number(range[3]) !== asset.size
      ) {
        await response.body.cancel();
        throw new Error('安装包续传范围无效');
      }
    } else if (response.status !== 200) {
      await response.body.cancel();
      throw new Error('安装包下载响应无效');
    }
    const remaining = asset.size - offset,
      length = response.headers.get('content-length');
    if (length && Number(length) !== remaining) {
      await response.body.cancel();
      throw new Error('安装包大小与发布信息不一致');
    }
    await saveMetadata(file, {
      ...asset,
      ...(etag && !etag.startsWith('W/') ? { etag } : {}),
      ...(modified ? { modified } : {}),
    });
    const output = await open(file, offset > 0 ? 'a' : 'w', 0o600);
    let received = offset,
      last = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (received > asset.size) {
          await output.truncate(0);
          throw new Error('安装包超过预期大小');
        }
        await output.writeFile(chunk);
        if (Date.now() - last >= 500) {
          await progress(received);
          last = Date.now();
        }
      }
      await output.sync();
      if (received !== asset.size) throw new TemporaryDownloadError('下载中断，已保留进度');
    } finally {
      await output.close();
    }
    if ((await hashFile(file)) !== asset.sha256) {
      await rm(file, { force: true });
      await rm(file + '.resume.json', { force: true });
      throw new Error('安装包 SHA-256 校验失败');
    }
    await progress(asset.size);
    return;
  }
  throw new Error('无法恢复下载，请重试');
}

class TemporaryDownloadError extends Error {}
function transientReason(error: unknown): string | null {
  if (error instanceof TemporaryDownloadError) return error.message;
  if (!(error instanceof Error)) return null;
  const cause = error.cause as { code?: string } | undefined;
  const code = (error as NodeJS.ErrnoException).code || cause?.code;
  if (error.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') return '连接超时';
  if (['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'].includes(code || ''))
    return '下载响应超时';
  if (
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'UND_ERR_SOCKET',
    ].includes(code || '') ||
    (error instanceof TypeError && ['fetch failed', 'terminated'].includes(error.message))
  )
    return '网络连接中断';
  return null;
}
/** Retry only transport failures; each attempt reloads the verified partial from disk. */
export async function downloadWithRetry(
  asset: UpdateSpec['asset'],
  file: string,
  progress: (received: number, line?: string) => Promise<void>,
  onRetry: (attempt: number, message: string) => Promise<void>,
  request: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  preferredRoute: DownloadRoute = 'direct',
): Promise<void> {
  const delays = [2000, 4000, 8000, 16000, 30000];
  for (let attempt = 0; ; attempt++) {
    const route: DownloadRoute =
      attempt % 2 === 0 ? preferredRoute : preferredRoute === 'direct' ? 'mirror' : 'direct';
    const line = route === 'mirror' ? '镜像加速' : 'GitHub 直连';
    try {
      console.info('[self-update] 下载线路：' + line);
      await downloadPackage(asset, file, (received) => progress(received, line), request, route);
      return;
    } catch (error) {
      const reason = transientReason(error);
      if (!reason) throw error;
      if (attempt === delays.length)
        throw new Error(`自动重试 ${delays.length} 次仍失败：${reason}，已保留下载进度`, {
          cause: error,
        });
      const nextLine = route === 'direct' ? '镜像加速线路' : 'GitHub 直连线路';
      const message = `${line}：${reason}，${delays[attempt] / 1000} 秒后切换至 ${nextLine} 重试（${attempt + 1}/${delays.length}）`;
      console.warn('[self-update]', message);
      await onRetry(attempt + 1, message);
      await pause(delays[attempt]);
    }
  }
}
