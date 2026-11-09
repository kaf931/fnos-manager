/** @param {string} host */
const local = (host: string) =>
  /^(localhost|127(?:\.\d+){3}|::1|\[::1\]|0\.0\.0\.0|::|\[::\])$/i.test(host);
/**
 * @param {{serviceUrl?: string}} container
 * @param {{containerPort: number, hostPort: number} | null | undefined} port
 * @param {{hostname?: string, native?: boolean}} state
 * @param {string} pageHostname
 */
export function containerAddress(
  container: { serviceUrl?: string },
  port: { containerPort: number; hostPort: number } | null | undefined,
  state: { hostname?: string; native?: boolean },
  pageHostname: string,
) {
  let host = state.hostname || pageHostname;
  if (state.native && local(host)) host = local(pageHostname) ? '' : pageHostname;
  try {
    const serviceUrl = container.serviceUrl || '';
    const labeled = new URL(serviceUrl);
    if (
      ['http:', 'https:'].includes(labeled.protocol) &&
      !serviceUrl.includes('[IP]') &&
      !serviceUrl.includes('[PORT:')
    ) {
      if (local(labeled.hostname)) {
        if (!host) return '';
        labeled.hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      }
      return labeled.href;
    }
  } catch {}
  if (!host || !port) return '';
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  const protocol = [443, 8443, 8920].includes(port.containerPort) ? 'https' : 'http';
  return `${protocol}://${host}:${port.hostPort}/`;
}
