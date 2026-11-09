import type { MonitorPrevious } from '../domain/terminal-files.js';
const ratio = (used: number, total: number) =>
  total > 0 ? Math.round(Math.max(0, Math.min(100, (used / total) * 100)) * 10) / 10 : 0;
export function monitorDetails(
  sections: Record<string, string>,
  stat: string,
  memory: Record<string, number>,
  previous: MonitorPrevious | null | undefined,
  sampledAt: number,
) {
  const prior = previous?.cpu ?? previous;
  const cores = [...stat.matchAll(/^cpu(\d+)\s+([^\n]+)/gm)].slice(0, 1024).map((m) => {
    const v = m[2].trim().split(/\s+/).map(Number),
      total = v.slice(0, 8).reduce((a, b) => a + b, 0),
      idle = v[3] + (v[4] || 0),
      old = prior?.cores?.find((c) => c.id === Number(m[1])),
      delta = old ? total - old.total : 0;
    return {
      id: Number(m[1]),
      total,
      idle,
      percent: old && delta > 0 && idle >= old.idle ? ratio(delta - idle + old.idle, delta) : null,
    };
  });
  const hostLines = (sections.HOST || '').trim().split('\n'),
    pretty = (sections.OS || '').match(/^PRETTY_NAME=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
  const uptime = Number.parseFloat(sections.UPTIME),
    load = (sections.LOAD?.trim() ? sections.LOAD.trim().split(/\s+/) : [])
      .slice(0, 3)
      .map(Number)
      .filter(Number.isFinite);
  const host = {
    name: hostLines[0] || '',
    user: hostLines[1] || '',
    kernel: hostLines[2] || '',
    system: pretty || '',
    uptime: Number.isFinite(uptime) ? uptime : null,
  };
  const swapTotal = memory.SwapTotal || 0,
    swapUsed = Math.max(0, swapTotal - (memory.SwapFree || 0)),
    swap = {
      total: swapTotal,
      used: swapUsed,
      percent: ratio(swapUsed, swapTotal),
    };
  const addresses = new Map<string, string[]>();
  for (const line of (sections.ADDR || '').split('\n')) {
    const m = line.match(/^\d+:\s+(\S+)\s+inet6?\s+([^/\s]+)/);
    if (!m) continue;
    const name = m[1].split('@')[0];
    addresses.set(name, [...(addresses.get(name) || []), m[2]]);
  }
  const elapsed = previous?.sampledAt ? (sampledAt - previous.sampledAt) / 1000 : 0;
  const links = new Map(
    [...(sections.LINK || '').matchAll(/^(\S+)\s+([01])\s+([a-z]+)$/gm)].map((m) => [
      m[1],
      { physical: m[2] === '1', state: m[3] },
    ]),
  );
  const network = [];
  for (const line of (sections.NET || '').split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    const counters = m[2].trim().split(/\s+/).map(Number);
    if (counters.length < 16 || !counters.every(Number.isFinite)) continue;
    const name = m[1].trim(),
      received = counters[0],
      transmitted = counters[8],
      old = previous?.network?.find((n) => n.name === name);
    network.push({
      name,
      ...links.get(name),
      received,
      transmitted,
      addresses: addresses.get(name) || [],
      receiveRate:
        old && elapsed > 0 && received >= old.received ? (received - old.received) / elapsed : null,
      transmitRate:
        old && elapsed > 0 && transmitted >= old.transmitted
          ? (transmitted - old.transmitted) / elapsed
          : null,
    });
  }
  const processes = [],
    processIds = new Set<number>();
  for (const line of (sections.PROCESS || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (m && !processIds.has(Number(m[1]))) {
      processIds.add(Number(m[1]));
      processes.push({
        pid: Number(m[1]),
        cpu: Number(m[2]),
        memory: Number(m[3]) * 1024,
        name: m[4].slice(0, 80),
      });
    }
    if (processes.length >= 20) break;
  }
  const defaultInterfaces = [
    ...new Set<string>([...(sections.ROUTE || '').matchAll(/\bdev\s+(\S+)/g)].map((m) => m[1])),
  ];
  return {
    host,
    load,
    swap,
    cores,
    defaultInterfaces,
    network: network.slice(0, 128),
    processes,
  };
}
