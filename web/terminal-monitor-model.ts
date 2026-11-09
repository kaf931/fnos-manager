import type {
  MonitorData,
  MonitorProcess,
  NetworkSample,
  SessionIdentity,
} from './contracts/terminal.js';
import { errorMessage } from './contracts/shared.js';
export interface MonitorSample {
  at: number;
  cpu: number | null;
  memory: number | null;
  receive: number | null;
  transmit: number | null;
}
export interface MonitorUpdate {
  data: MonitorData | null;
  message: string;
}
export function createMonitorPoller({
  read,
  update,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
}: {
  read: (id: string) => Promise<MonitorData>;
  update: (value: MonitorUpdate) => void;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (id: ReturnType<typeof setTimeout> | undefined) => void;
}) {
  let key = '',
    epoch = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false;
  function select(target: SessionIdentity | null | undefined) {
    const next = target?.connected ? target.id + ':' + target.generation : '';
    if (disposed || next === key) return;
    key = next;
    const generation = ++epoch;
    cancel(timer);
    update({ data: null, message: next ? '正在读取系统监控…' : '请先连接 SSH 主机' });
    if (!next || !target?.id) return;
    const targetId = target.id;
    async function poll() {
      try {
        const data = await read(targetId);
        if (disposed || generation !== epoch) return;
        update({ data, message: '' });
      } catch (e) {
        if (disposed || generation !== epoch) return;
        update({ data: null, message: errorMessage(e, '系统监控暂不可用') });
      }
      if (!disposed && generation === epoch) timer = schedule(poll, 3000);
    }
    poll();
  }
  update({ data: null, message: '请先连接 SSH 主机' });
  return {
    select,
    dispose() {
      disposed = true;
      ++epoch;
      cancel(timer);
    },
  };
}
export function createMonitorHistory(limit = 60) {
  const targets = new Map<string, MonitorSample[]>();
  return {
    push(key: string, data: MonitorData) {
      let samples = targets.get(key);
      if (!samples) {
        samples = [];
        targets.set(key, samples);
        if (targets.size > 8) targets.delete(targets.keys().next().value!);
      }
      if (samples.at(-1)?.at !== data.sampledAt) {
        while (samples.length && samples[0].at < data.sampledAt - 180000) samples.shift();
        const rates = networkRates(data);
        samples.push({
          at: data.sampledAt,
          cpu: data.cpu?.percent ?? null,
          memory: data.memory?.percent ?? null,
          receive: rates.receive,
          transmit: rates.transmit,
        });
        if (samples.length > limit) samples.splice(0, samples.length - limit);
      }
      return samples;
    },
  };
}

export function networkRates(data: MonitorData | null | undefined) {
  const interfaces = (data?.network || []).filter((n) =>
    data?.defaultInterfaces?.length
      ? data.defaultInterfaces.includes(n.name)
      : n.name !== 'lo' && !/^(?:veth|docker|br-|virbr)/.test(n.name),
  );
  const sum = (key: 'receiveRate' | 'transmitRate') =>
    interfaces.some((n) => Number.isFinite(n[key]))
      ? interfaces.reduce((total, n) => total + (Number.isFinite(n[key]) ? (n[key] ?? 0) : 0), 0)
      : null;
  return { receive: sum('receiveRate'), transmit: sum('transmitRate') };
}
export function filterMonitorNetworks(data: MonitorData | null | undefined, scope = 'common') {
  const network = data?.network || [];
  if (scope === 'all') return network;
  const physical = (n: NetworkSample) =>
    n.physical === true || (n.physical === undefined && /^(?:eth\d|en\w|wl\w)/.test(n.name));
  if (scope === 'physical') return network.filter(physical);
  const virtual = /^(?:lo$|veth|docker|br-|virbr|ovs-system$|tun\d|tap\d)/;
  return network.filter(
    (n) =>
      data?.defaultInterfaces?.includes(n.name) ||
      (n.state !== 'down' &&
        n.addresses?.length &&
        (physical(n) || (n.physical === undefined && !virtual.test(n.name)))),
  );
}
export function formatTransferRate(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return { value: '—', unit: '' };
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return {
    value: value >= 100 || i === 0 ? String(Math.round(value)) : String(Number(value.toFixed(1))),
    unit: units[i],
  };
}

export function rankMonitorProcesses(
  processes: MonitorProcess[] | undefined,
  metric = 'cpu',
  descending = true,
) {
  const key = metric === 'memory' ? 'memory' : 'cpu';
  return [...(processes || [])]
    .sort((a, b) => (descending ? b[key] - a[key] : a[key] - b[key]) || a.pid - b.pid)
    .slice(0, 5);
}
