// Internal endpoint; user-facing text identifies only the route category.
export const UPDATE_MIRROR_ORIGIN = 'https://gh-proxy.org';
export function publicUpdateText(text: string): string {
  const host = new URL(UPDATE_MIRROR_ORIGIN).hostname;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`https?://${escaped}[^\\s)\\]}"']*`, 'g'), '镜像加速')
    .replaceAll(host + ' 加速线路', '镜像加速线路')
    .replaceAll(host + ' 加速', '镜像加速')
    .replaceAll(host, '镜像加速');
}
