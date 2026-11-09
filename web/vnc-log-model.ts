import type { VncLogEntry, VncLogStage, VncLogLevel } from '../backend/domain/vnc.js';
export const vncStageLabels: Record<VncLogStage, string> = {
  session: '会话',
  websocket: 'WebSocket',
  network: '网络',
  protocol: '协议',
  auth: '认证',
  desktop: '画面',
  performance: '性能',
  disconnect: '断开',
};
export function authenticationLabel(type: number) {
  const names: { [key: number]: string } = {
    1: '无认证',
    2: 'VNC 密码认证',
    5: 'RSA-AES 认证',
    16: 'Tight 认证',
    19: 'VeNCrypt 认证',
    22: 'XVP 认证',
    30: 'Apple 账户认证',
    113: 'MSLogonII 认证',
    256: 'Plain 认证',
  };
  return names[type] ?? `认证类型 ${type}`;
}
export interface VncLogRow extends VncLogEntry {
  source: '客户端' | '后端';
  key: number;
}
export function createVncLog(now: () => number = Date.now, limit = 200) {
  let entries: VncLogRow[] = [],
    serial = 0,
    epoch = 0,
    started = now(),
    secrets: string[] = [];
  const seen = new Map<string, number>();
  function sanitize(value: string) {
    let safe = value.replace(/[\x00-\x1f\x7f]/g, ' ');
    for (const secret of secrets) if (secret) safe = safe.split(secret).join('[已隐藏]');
    return safe.replace(/\b(ticket|token|password)=\S+/gi, '$1=[已隐藏]').slice(0, 600);
  }
  function push(row: VncLogEntry, source: VncLogRow['source']) {
    entries.push({ ...row, message: sanitize(row.message), source, key: ++serial });
    entries.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.key - b.key);
    entries = entries.slice(-limit);
  }
  return {
    get epoch() {
      return epoch;
    },
    begin() {
      started = now();
    },
    protect(values: string[]) {
      secrets = values;
    },
    add(stage: VncLogStage, level: VncLogLevel, message: string) {
      push(
        {
          id: 0,
          time: new Date(now()).toISOString(),
          elapsedMs: Math.max(0, now() - started),
          stage,
          level,
          message,
        },
        '客户端',
      );
    },
    merge(session: string, rows: VncLogEntry[], expectedEpoch = epoch) {
      let cursor = seen.get(session) ?? 0;
      for (const row of rows) {
        if (row.id <= cursor) continue;
        cursor = row.id;
        if (expectedEpoch === epoch) push(row, '后端');
      }
      seen.set(session, cursor);
      while (seen.size > 16) seen.delete(seen.keys().next().value!);
    },
    clear() {
      entries = [];
      epoch++;
    },
    items() {
      return entries.map((row) => ({ ...row }));
    },
    text() {
      return entries
        .map(
          (row) =>
            `${row.time} +${row.elapsedMs}ms [${row.source}/${vncStageLabels[row.stage]}] ${row.level} ${row.message}`,
        )
        .join('\n');
    },
  };
}
