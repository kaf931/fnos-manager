import sharp from 'sharp';
import { httpUrl } from './core.js';
export async function defaultIcon() {
  return sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="12" y="12" width="232" height="232" rx="52" fill="#0066ff"/><g fill="#fff"><rect x="66" y="66" width="50" height="50" rx="12"/><rect x="140" y="66" width="50" height="50" rx="12"/><rect x="66" y="140" width="50" height="50" rx="12"/><rect x="140" y="140" width="50" height="50" rx="12"/></g></svg>',
    ),
  )
    .png()
    .toBuffer();
}
export async function renderIcon(buffer: Buffer, size: number) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 5 * 1024 * 1024)
    throw new Error('图片不能超过 5 MB');
  const image = sharp(buffer, {
    limitInputPixels: 16_000_000,
    animated: false,
  });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp', 'gif', 'tiff', 'heif'].includes(meta.format ?? ''))
    throw new Error('请上传 PNG、JPG、WebP 或 GIF 图片');
  // Remove transparent canvas padding only, preserving real artwork and aspect ratio.
  // Re-normalizing an already generated icon must never shrink its visible bounds.
  const { data, info } = await image
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] >= 8) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  if (right < left) throw new Error('图标没有可见内容');
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="white"/></svg>`,
  );
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .composite([{ input: mask, blend: 'dest-in' }])
    .toColourspace('srgb')
    .png()
    .toBuffer();
}
async function boundedFetch(
  address: string,
  limit: number = 5 * 1024 * 1024,
  redirects: number = 0,
): Promise<{ buffer: Buffer; url: string; type: string }> {
  const url = new URL(httpUrl(address));
  if (['169.254.169.254', 'metadata.google.internal'].includes(url.hostname))
    throw new Error('不支持该地址');
  const res = await fetch(url, {
    signal: AbortSignal.timeout(4500),
    redirect: 'manual',
    headers: { Accept: 'image/*,text/html;q=0.8' },
  });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    if (redirects >= 3) throw new Error('重定向次数过多');
    const location = res.headers.get('location');
    if (!location) throw new Error('重定向缺少目标地址');
    return boundedFetch(new URL(location, url).href, limit, redirects + 1);
  }
  if (!res.ok) throw new Error(`请求失败 (${res.status})`);
  if (!res.body) throw new Error('远程内容为空');
  const reader = res.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error('远程内容过大');
    }
    chunks.push(value);
  }
  return {
    buffer: Buffer.concat(chunks),
    url: res.url,
    type: res.headers.get('content-type') || '',
  };
}
export async function discoverIcon(serviceUrl: string | undefined, iconUrl: string | undefined) {
  const candidates = [];
  if (iconUrl) candidates.push({ url: httpUrl(iconUrl), source: '容器标签' });
  if (serviceUrl) {
    const url = httpUrl(serviceUrl);
    try {
      const page = await boundedFetch(url, 1024 * 1024);
      if (page.type.includes('text/html')) {
        const html = page.buffer.toString();
        const tags = html.match(/<link\b[^>]*>/gi) || [];
        for (const tag of tags) {
          if (!/\brel\s*=\s*["'][^"']*\b(?:icon|apple-touch-icon)\b/i.test(tag)) continue;
          const match = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
          if (match)
            candidates.push({
              url: new URL(match[1].replace(/&amp;/g, '&'), page.url).href,
              source: '应用网页',
            });
        }
      }
    } catch {}
    candidates.push({
      url: new URL('/favicon.ico', url).href,
      source: '网站图标',
    });
  }
  for (const candidate of candidates.slice(0, 6)) {
    try {
      const result = await boundedFetch(candidate.url);
      const png = await renderIcon(result.buffer, 256);
      return { buffer: png, source: candidate.source };
    } catch {}
  }
  return { buffer: await defaultIcon(), source: '默认图标' };
}
