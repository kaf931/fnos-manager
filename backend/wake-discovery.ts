import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { normalizeMac } from './wol.js';
const execute = promisify(execFile);
type Link = { ifname: string; addr_info?: { family: string; local: string; prefixlen: number }[] };
type Route = { dev?: string };
type Neighbor = { dst?: string; dev?: string; lladdr?: string; state?: string[] };
type Network = {
  interface: string;
  cidr: string;
  broadcast: string;
  hosts: string[];
  local: string[];
};
export type DiscoveredDevice = {
  name: string;
  ip: string;
  mac: string;
  address: string;
  port: number;
};
const ipv4 = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
const integer = (address: string) =>
  address.split('.').reduce((n, x) => (n * 256 + Number(x)) >>> 0, 0);
function privateAddress(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
/** Only NAS default-route LANs; wide networks are limited to the NAS's local /24. */
export function discoveryNetworks(links: Link[], routes: Route[]): Network[] {
  const defaults = new Set(routes.map((r) => r.dev)),
    networks = new Map<string, Network>();
  for (const link of links) {
    if (
      !defaults.has(link.ifname) ||
      !/^[\w.:-]{1,32}$/.test(link.ifname) ||
      /^(lo$|tun|tap|wg|docker|br-|veth|virbr)/.test(link.ifname)
    )
      continue;
    for (const addr of link.addr_info || []) {
      if (
        addr.family !== 'inet' ||
        !privateAddress(addr.local) ||
        !Number.isInteger(addr.prefixlen) ||
        addr.prefixlen < 0 ||
        addr.prefixlen > 30
      )
        continue;
      const prefix = Math.max(24, addr.prefixlen),
        count = 2 ** (32 - prefix),
        start = (integer(addr.local) & (0xffffffff << (32 - prefix))) >>> 0,
        cidr = ipv4(start) + '/' + prefix;
      const previous = networks.get(cidr);
      if (previous) {
        previous.local.push(addr.local);
        continue;
      }
      if (networks.size >= 2) continue;
      networks.set(cidr, {
        interface: link.ifname,
        cidr,
        // The /24 cap limits probes only; WOL must target the real subnet broadcast.
        broadcast: ipv4((integer(addr.local) | (0xffffffff >>> addr.prefixlen)) >>> 0),
        local: [addr.local],
        hosts: Array.from({ length: count - 2 }, (_, i) => ipv4(start + i + 1)),
      });
    }
  }
  return [...networks.values()];
}
export function discoveryDevices(neighbors: Neighbor[], networks: Network[]): DiscoveredDevice[] {
  const devices = new Map<string, DiscoveredDevice>();
  for (const row of neighbors) {
    const network = networks.find(
      (n) =>
        n.interface === row.dev &&
        n.hosts.includes(row.dst || '') &&
        !n.local.includes(row.dst || ''),
    );
    if (!network || !row.lladdr || row.state?.some((s) => ['FAILED', 'INCOMPLETE'].includes(s)))
      continue;
    try {
      const mac = normalizeMac(row.lladdr);
      if (!devices.has(mac))
        devices.set(mac, {
          name: '设备 ' + row.dst,
          ip: row.dst!,
          mac,
          address: network.broadcast,
          port: 9,
        });
    } catch {
      /* Unresolved and multicast neighbors cannot be WOL targets. */
    }
  }
  return [...devices.values()].sort((a, b) => integer(a.ip) - integer(b.ip));
}
type Run = (binary: string, args: string[], signal: AbortSignal) => Promise<string>;
const runCommand: Run = async (binary, args, signal) =>
  (await execute(binary, args, { signal, timeout: 2000, maxBuffer: 262144, encoding: 'utf8' }))
    .stdout;
export class LanDiscovery {
  private pending: Promise<{ networks: string[]; devices: DiscoveredDevice[] }> | null = null;
  private cached: {
    at: number;
    value: { networks: string[]; devices: DiscoveredDevice[] };
  } | null = null;
  private controller: AbortController | null = null;
  constructor(private readonly run: Run = runCommand) {}
  scan() {
    if (this.pending) return this.pending;
    if (this.cached && Date.now() - this.cached.at < 15000)
      return Promise.resolve(this.cached.value);
    const controller = (this.controller = new AbortController());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
    const work = this.read(signal);
    this.pending = work;
    void work
      .then((value) => {
        this.cached = { at: Date.now(), value };
      })
      .finally(() => {
        this.pending = null;
        this.controller = null;
      })
      .catch(() => {});
    return work;
  }
  private async read(signal: AbortSignal) {
    const [links, routes] = await Promise.all([
      this.run('ip', ['-j', '-4', 'addr', 'show', 'scope', 'global'], signal),
      this.run('ip', ['-j', '-4', 'route', 'show', 'default'], signal),
    ]);
    const networks = discoveryNetworks(JSON.parse(links), JSON.parse(routes));
    if (!networks.length)
      throw Object.assign(Error('未找到可扫描的局域网，请检查 NAS 默认路由和 IPv4 地址'), {
        status: 422,
      });
    const targets = networks.flatMap((n) =>
      n.hosts.filter((ip) => !n.local.includes(ip)).map((ip) => ({ ip, interface: n.interface })),
    );
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(32, targets.length) }, async () => {
        while (index < targets.length && !signal.aborted) {
          const target = targets[index++];
          try {
            await this.run(
              'ping',
              ['-n', '-c', '1', '-W', '1', '-I', target.interface, target.ip],
              signal,
            );
          } catch {
            /* ARP may resolve even when ICMP is blocked. */
          }
        }
      }),
    );
    if (signal.aborted)
      throw Object.assign(Error('局域网扫描已取消或超时，请重试'), { status: 504 });
    const neighbors = JSON.parse(await this.run('ip', ['-j', '-4', 'neigh', 'show'], signal));
    return {
      networks: networks.map((n) => n.cidr),
      devices: discoveryDevices(neighbors, networks),
    };
  }
  close() {
    this.controller?.abort();
  }
}
