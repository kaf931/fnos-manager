import type { ApiClient } from './contracts/shared.js';
import type { WakeDevice } from './contracts/wake.js';
type StatusRow = Pick<WakeDevice, 'presence' | 'checking'>;
const stale = (row: StatusRow, now: number) =>
  !row.presence || now - Date.parse(row.presence.checkedAt) > 120000;
export function wakePresenceLabel(row: StatusRow, now = Date.now()): string {
  if (row.checking) return '检测中…';
  if (stale(row, now)) return '未知';
  return row.presence?.state === 'online'
    ? '在线'
    : row.presence?.state === 'offline'
      ? '未响应'
      : '未知';
}
export function wakePresenceTitle(row: StatusRow, now = Date.now()): string {
  const p = row.presence;
  if (!p) return '尚未检测；可在设备操作中检测状态';
  const reasons = {
    reply: '设备响应了网络探测',
    no_reply: '设备未响应网络探测，不代表设备已关机',
    unavailable: '探测不可用，无法判断设备状态',
    no_target: '请填写设备 IP，或关联使用局域网 IPv4 地址的 SSH 连接',
  };
  return [
    reasons[p.reason],
    stale(row, now) ? '结果已过期，请重新检测' : '',
    '检测时间：' + new Date(p.checkedAt).toLocaleString('zh-CN'),
  ]
    .filter(Boolean)
    .join('；');
}
export function createWakeMonitor({
  api,
  onRows,
  onError,
  onBusy,
  schedule = (fn, ms) => window.setTimeout(fn, ms),
  cancel = (id) => window.clearTimeout(id),
}: {
  api: ApiClient;
  onRows: (rows: WakeDevice[]) => void;
  onError: (error: unknown) => void;
  onBusy: (busy: boolean) => void;
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (id: number) => void;
}) {
  let active = false,
    disposed = false,
    generation = 0,
    timer: number | undefined;
  let pending:
    { generation: number; check: boolean; ids?: string[]; promise: Promise<void> } | undefined;
  const clear = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  async function refresh(check = false, ids?: string[]) {
    if (disposed || !active) return;
    if (pending?.generation === generation) {
      const previous = pending;
      const covered =
        previous.check &&
        (previous.ids === undefined ||
          (ids !== undefined && ids.every((id) => previous.ids!.includes(id))));
      if (check && !covered) {
        await previous.promise;
        if (!disposed && active && generation === previous.generation) return refresh(true, ids);
        return;
      }
      return previous.promise;
    }
    clear();
    const ticket = generation;
    const current = () => !disposed && active && generation === ticket;
    onBusy(true);
    // Defer the body so pending is registered even for synchronously rejected clients.
    const work = Promise.resolve().then(async () => {
      let rows: WakeDevice[] = [];
      let loaded = false;
      try {
        if (!current()) return;
        rows = await api<WakeDevice[]>('/wake/devices');
        loaded = true;
        if (!current()) return;
        onRows(rows);
        if (check) {
          const selected = ids
            ? rows.filter((r) => ids.includes(r.id)).map((r) => r.id)
            : rows.map((r) => r.id);
          onRows(rows.map((r) => (selected.includes(r.id) ? { ...r, checking: true } : r)));
          for (let i = 0; i < selected.length && current(); i += 50)
            await api<WakeDevice[]>('/wake/check', 'POST', { ids: selected.slice(i, i + 50) });
          if (!current()) return;
          rows = await api<WakeDevice[]>('/wake/devices');
          if (!current()) return;
          onRows(rows);
        }
      } catch (error) {
        if (current()) {
          if (loaded) onRows(rows);
          onError(error);
        }
      } finally {
        if (pending?.generation === ticket) pending = undefined;
        if (current()) {
          onBusy(false);
          // Only poll active followups; otherwise repaint once when cached evidence expires.
          const expiry = rows
            .flatMap((r) =>
              r.presence ? [Date.parse(r.presence.checkedAt) + 120001 - Date.now()] : [],
            )
            .filter((n) => n > 0);
          const delay = rows.some((r) => r.checking)
            ? 2000
            : expiry.length
              ? Math.min(...expiry)
              : 0;
          if (delay > 0)
            timer = schedule(() => {
              timer = undefined;
              void refresh();
            }, delay);
        }
      }
    });
    pending = { generation: ticket, check, ids: ids ? [...ids] : undefined, promise: work };
    return work;
  }
  return {
    refresh,
    reload() {
      generation++;
      clear();
      return refresh();
    },
    setActive(value: boolean) {
      if (value === active || disposed) return;
      active = value;
      generation++;
      clear();
      onBusy(false);
    },
    dispose() {
      disposed = true;
      active = false;
      generation++;
      clear();
      onBusy(false);
    },
  };
}
