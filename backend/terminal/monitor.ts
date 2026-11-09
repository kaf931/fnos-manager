import type { Client, ClientChannel } from 'ssh2';
import type { CpuSample, MonitorPrevious } from '../domain/terminal-files.js';
import { fail } from './model.js';
import { monitorDetails } from './monitor-details.js';
// A separate read-only SSH channel keeps monitoring out of the interactive shell.
const commands = [
  ['MEM', 'cat /proc/meminfo'],
  ['DISK', 'df -PTk'],
  ['HOST', 'uname -n; id -un; uname -r'],
  ['OS', 'cat /etc/os-release'],
  ['UPTIME', 'cat /proc/uptime'],
  ['LOAD', 'cat /proc/loadavg'],
  ['NET', 'cat /proc/net/dev'],
  [
    'LINK',
    'for n in /sys/class/net/*; do [ -e "$n" ] || continue; physical=0; [ -e "$n/device" ] && physical=1; printf "%s %s " "${n##*/}" "$physical"; cat "$n/operstate" 2>/dev/null || printf "unknown\\n"; done',
  ],
  ['ADDR', 'ip -o addr show'],
  ['ROUTE', 'ip -o route show default'],
  [
    'PROCESS',
    `for order in -pcpu pcpu -rss rss; do ps -eo pid=,ppid=,pcpu=,rss=,comm= --sort="$order" | awk -v parent="$$" '$1 != parent && $2 != parent { $2=""; print; if (++n == 5) exit }'; done`,
  ],
];
export const monitorCommand =
  'LC_ALL=C; export LC_ALL; cat /proc/stat; ' +
  commands.map(([name, cmd]) => "printf '\\n__" + name + "__\\n'; " + cmd).join('; ');
const percent = (used: number, total: number) =>
  total > 0 ? Math.round(Math.max(0, Math.min(100, (used / total) * 100)) * 10) / 10 : null;
export function parseMonitor(text: string, previous?: MonitorPrevious | null) {
  const parts = text.split(/\n__([A-Z]+)__\n/),
    stat = parts[0],
    sections: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) sections[parts[i]] = parts[i + 1];
  const mem = sections.MEM || '',
    df = sections.DISK || '',
    values = stat
      .match(/^cpu\s+([\d\s]+)$/m)?.[1]
      .trim()
      .split(/\s+/)
      .map(Number);
  const memory: Record<string, number> = Object.fromEntries(
    [...mem.matchAll(/^(\w+):\s+(\d+) kB/gm)].map((m) => [m[1], Number(m[2]) * 1024]),
  );
  if (!values || values.length < 4 || !memory.MemTotal)
    throw fail('目标主机暂不支持 Linux 系统监控', 422);
  const prior = previous?.cpu ?? previous;
  const total = values.slice(0, 8).reduce((a, b) => a + b, 0),
    idle = values[3] + (values[4] || 0),
    delta = prior ? total - (prior.total ?? 0) : 0;
  const cpu: CpuSample = {
    total,
    idle,
    percent:
      prior && delta > 0 && idle >= (prior.idle ?? 0)
        ? percent(delta - (idle - (prior.idle ?? 0)), delta)
        : null,
  };
  const available = Math.min(
    memory.MemTotal,
    memory.MemAvailable ?? (memory.MemFree || 0) + (memory.Buffers || 0) + (memory.Cached || 0),
  );
  const disks = [];
  for (const line of df.split('\n')) {
    const m = line.match(/^(\S+)\s+(?:(\S+)\s+)?(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/);
    if (!m) continue;
    const [, device, type, size, used, free, mount] = m;
    if (!Number(size)) continue;
    if (
      type
        ? !/^(?:ext[234]|xfs|btrfs|zfs|vfat|exfat|ntfs3?|fuseblk|f2fs|jfs|reiserfs|bcachefs|ufs)$/.test(
            type,
          )
        : !(device.startsWith('/dev/') || (device.includes('/') && !device.includes(':')))
    )
      continue;
    disks.push({
      device,
      mount,
      total: Number(size) * 1024,
      used: Number(used) * 1024,
      available: Number(free) * 1024,
      percent: percent(Number(used), Number(used) + Number(free)),
    });
  }
  // Repeated bind mounts must not count the same filesystem more than once.
  const unique = [...new Map(disks.map((d) => [d.device, d])).values()],
    disk = unique.reduce(
      (a, d) => ({
        total: a.total + d.total,
        used: a.used + d.used,
        available: a.available + d.available,
      }),
      { total: 0, used: 0, available: 0 },
    );
  const diskSummary = { ...disk, percent: percent(disk.used, disk.used + disk.available) };
  const sampledAt = Date.now(),
    details = monitorDetails(sections, stat, memory, previous, sampledAt);
  cpu.cores = details.cores;
  const { cores: _, ...withoutCores } = details;
  return {
    ...withoutCores,
    cpu,
    memory: {
      total: memory.MemTotal,
      available,
      used: memory.MemTotal - available,
      percent: percent(memory.MemTotal - available, memory.MemTotal),
    },
    disk: diskSummary,
    disks,
    sampledAt,
  };
}
export class SessionMonitor {
  declare client: Client;
  declare closed: boolean;
  declare pending: Promise<ReturnType<typeof parseMonitor>> | null;
  declare cached: ReturnType<typeof parseMonitor> | null;
  declare cancel: (() => void) | null;
  declare channel: ClientChannel | null;

  constructor(client: Client) {
    this.client = client;
    this.closed = false;
  }
  read() {
    if (this.closed) return Promise.reject(fail('SSH 会话未连接', 409));
    if (this.pending) return this.pending;
    if (this.cached && Date.now() - this.cached.sampledAt < 2000)
      return Promise.resolve(this.cached);
    const read = new Promise<ReturnType<typeof parseMonitor>>((resolve, reject) => {
      let done = false,
        bytes = 0;
      const chunks: Buffer[] = [];
      const finish = (error?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.cancel = null;
        this.channel = null;
        if (error) {
          channel?.destroy();
          reject(error);
        } else
          try {
            this.cached = parseMonitor(Buffer.concat(chunks).toString(), this.cached);
            resolve(this.cached);
          } catch (e) {
            reject(e);
          }
      };
      let channel: ClientChannel | undefined;
      const timer = setTimeout(() => finish(fail('系统监控读取超时', 504)), 5000);
      timer.unref?.();
      this.cancel = () => finish(fail('SSH 会话未连接', 409));
      try {
        this.client.exec(monitorCommand, (error, stream) => {
          if (done) {
            stream?.destroy();
            return;
          }
          if (error) {
            finish(fail('无法读取系统监控', 502));
            return;
          }
          channel = this.channel = stream;
          stream.on('data', (data: Buffer) => {
            bytes += data.length;
            if (bytes > 262144) finish(fail('系统监控数据过大', 502));
            else chunks.push(Buffer.from(data));
          });
          stream.stderr?.on('data', (data: Buffer) => {
            bytes += data.length;
            if (bytes > 262144) finish(fail('系统监控数据过大', 502));
          });
          stream.on('error', () => finish(fail('系统监控读取失败', 502)));
          stream.on('end', () => finish());
          stream.on('close', () => finish());
        });
      } catch {
        finish(fail('无法读取系统监控', 502));
      }
    });
    this.pending = read;
    read
      .finally(() => {
        if (this.pending === read) this.pending = null;
      })
      .catch(() => {});
    return read;
  }
  close() {
    this.closed = true;
    this.cancel?.();
  }
}
