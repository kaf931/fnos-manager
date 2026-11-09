import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
function defaultRoutes(): string {
  try {
    return readFileSync('/proc/net/route', 'utf8');
  } catch {
    return '';
  }
}
const loopback = (value: string) =>
  /^(localhost|127(?:\.\d+){3}|::1|\[::1\]|0\.0\.0\.0|::)$/i.test(value);
export function nasAddress(
  requested: string,
  interfaces: Record<
    string,
    Pick<NetworkInterfaceInfo, 'address' | 'family' | 'internal'>[] | undefined
  > = networkInterfaces(),
  configured = process.env.NAS_HOST || '',
  routeText = defaultRoutes(),
): string {
  if (configured && !loopback(configured)) return configured;
  const routes = routeText
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row[1] === '00000000' && (parseInt(row[3], 16) & 1) === 1)
    .sort((a, b) => Number(a[6]) - Number(b[6]))
    .map((row) => row[0]);
  const addresses = Object.entries(interfaces)
    .filter(
      ([name]) => !/^(lo$|docker|veth|br-|virbr|tun|tap|tailscale|wg|flannel|cni)/i.test(name),
    )
    .sort(([a], [b]) => {
      const rank = (name: string) => (routes.includes(name) ? routes.indexOf(name) : routes.length);
      return rank(a) - rank(b);
    })
    .flatMap(([, rows]) => rows || [])
    .filter(
      (row) =>
        !row.internal &&
        row.family === 'IPv4' &&
        !loopback(row.address) &&
        !row.address.startsWith('169.254.'),
    )
    .map((row) => row.address);
  if (addresses.includes(requested)) return requested;
  if (addresses.length) return addresses[0];
  return requested && isIP(requested.replace(/^\[|\]$/g, '')) && !loopback(requested)
    ? requested
    : '';
}
