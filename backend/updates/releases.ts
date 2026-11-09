import { publicUpdateText } from './routes.js';
export const RELEASES_URL = 'https://github.com/kaf931/fnos-manager/releases';
export interface ReleaseInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  architecture: string;
  notes: string;
  warning?: string;
  url: string;
  asset: { name: string; url: string; size: number; sha256?: string } | null;
}
function version(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
export function parseRelease(data: unknown, current: string, arch: string): ReleaseInfo {
  const base: ReleaseInfo = {
    current,
    latest: null,
    hasUpdate: false,
    architecture: arch,
    notes: '',
    url: RELEASES_URL,
    asset: null,
  };
  if (!data || typeof data !== 'object') return base;
  const release = data as Record<string, unknown>;
  if (release.draft || release.prerelease || typeof release.tag_name !== 'string') return base;
  const latest = version(release.tag_name),
    installed = version(current);
  if (!latest) return base;
  const newer = installed ? latest.findIndex((n, i) => n !== installed[i]) : -1;
  base.latest = release.tag_name;
  base.hasUpdate = !!installed && newer >= 0 && latest[newer] > installed[newer];
  base.notes =
    typeof release.body === 'string' ? publicUpdateText(release.body.slice(0, 100000)) : '';
  base.url = `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`;
  const candidates = (Array.isArray(release.assets) ? release.assets : []).filter(
    (item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const a = item as Record<string, unknown>;
      if (typeof a.name !== 'string' || !a.name.toLowerCase().endsWith('.fpk')) return false;
      const name = a.name.toLowerCase();
      const arm = /(?:^|[-_.])(arm64|aarch64|arm)(?:[-_.]|$)/.test(name);
      const x86 = /(?:^|[-_.])(x86_64|amd64|x64|x86)(?:[-_.]|$)/.test(name);
      return arch === 'arm64' ? arm && !x86 : arch === 'x64' && !arm;
    },
  ) as Record<string, unknown>[];
  if (candidates.length === 1) {
    const a = candidates[0];
    const url = typeof a.browser_download_url === 'string' ? a.browser_download_url : '';
    if (url.startsWith(`${RELEASES_URL}/download/`))
      base.asset = {
        name: String(a.name),
        url,
        size: typeof a.size === 'number' ? a.size : 0,
        ...(typeof a.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(a.digest)
          ? { sha256: a.digest.slice(7) }
          : {}),
      };
  }
  return base;
}

export class ReleaseWithdrawn extends Error {}
/** A download URL can outlive a deleted Release. Revalidate the exact tag and
 * original official digest immediately before crossing the installation boundary. */
export async function verifyPublishedRelease(
  spec: Pick<
    import('./job.js').UpdateSpec,
    'asset' | 'version' | 'previousVersion' | 'architecture'
  >,
  request: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(spec.asset.url);
  const match = /^\/kaf931\/fnos-manager\/releases\/download\/([^/]+)\/[^/]+$/.exec(url.pathname);
  if (url.origin !== 'https://github.com' || !match) throw new Error('安装包来源无效');
  const tag = decodeURIComponent(match[1]);
  const response = await request(
    `https://api.github.com/repos/kaf931/fnos-manager/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fnos-manager-update-check' },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (response.status === 404)
    throw new ReleaseWithdrawn('此版本已从 GitHub 撤回，更新已停止，下载缓存已保留');
  if (!response.ok)
    throw new Error(
      `暂时无法确认发布是否仍有效（HTTP ${response.status}），本次未安装，请稍后重试`,
    );
  const release = parseRelease(await response.json(), spec.previousVersion, spec.architecture);
  if (
    release.latest?.replace(/^v/, '') !== spec.version ||
    release.asset?.url !== spec.asset.url ||
    release.asset?.size !== spec.asset.size ||
    release.asset?.sha256 !== spec.asset.sha256
  )
    throw new ReleaseWithdrawn('发布或安装包信息已变化，更新已停止，请重新检查；下载缓存已保留');
}
