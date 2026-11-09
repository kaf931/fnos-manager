export const canSendInput = (state: string) => state === 'connected';
export function auxiliaryKey(key: string, ctrl = false) {
  const keys: Record<string, string> = {
    Escape: '\x1b',
    Tab: '\t',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
  };
  if (keys[key]) return keys[key];
  if (key.length === 1) {
    if (ctrl && /^[a-z@\[\\\]\^_]$/i.test(key))
      return String.fromCharCode(key.toUpperCase().charCodeAt(0) & 31);
    return key;
  }
  return '';
}
export function normalizeSize(cols: number, rows: number) {
  const clamp = (n: number, min: number, max: number, fallback: number) =>
    Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
  return { cols: clamp(cols, 2, 500, 80), rows: clamp(rows, 1, 300, 24) };
}
export const terminalStates = {
  pending: '准备连接',
  connecting: '连接中',
  'host-key': '确认主机',
  credentials: '等待认证',
  authenticating: '认证中',
  connected: '已连接',
  disconnected: '已断开',
};

/** Validate the browser transport boundary before session events reach the UI. */
export function decodeTerminalEvent(
  value: unknown,
): import('./contracts/terminal.js').TerminalEvent | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  switch (value.type) {
    case 'diagnostic':
      if (
        'stage' in value &&
        typeof value.stage === 'string' &&
        ['network', 'handshake', 'fingerprint', 'authentication', 'sftp'].includes(value.stage) &&
        'status' in value &&
        typeof value.status === 'string' &&
        ['running', 'waiting', 'passed', 'failed'].includes(value.status) &&
        'message' in value &&
        typeof value.message === 'string' &&
        value.message.length <= 512 &&
        'at' in value &&
        typeof value.at === 'number' &&
        Number.isFinite(value.at)
      )
        return {
          type: 'diagnostic',
          stage: value.stage as import('../backend/domain/terminal-files.js').ConnectionStage,
          status:
            value.status as import('../backend/domain/terminal-files.js').ConnectionDiagnostic['status'],
          message: value.message,
          at: value.at,
        };
      break;
    case 'state':
      if (
        'state' in value &&
        typeof value.state === 'string' &&
        Object.hasOwn(terminalStates, value.state)
      )
        return { type: 'state', state: value.state as keyof typeof terminalStates };
      break;
    case 'output':
      if (
        'data' in value &&
        typeof value.data === 'string' &&
        (!('seq' in value) || typeof value.seq === 'number')
      )
        return {
          type: 'output',
          data: value.data,
          ...('seq' in value ? { seq: value.seq as number } : {}),
        };
      break;
    case 'error':
      if (
        'code' in value &&
        typeof value.code === 'string' &&
        'message' in value &&
        typeof value.message === 'string'
      )
        return { type: 'error', code: value.code, message: value.message };
      break;
    case 'credentials-required':
      return { type: 'credentials-required' };
    case 'host-key':
      if (
        'host' in value &&
        typeof value.host === 'string' &&
        'port' in value &&
        typeof value.port === 'number' &&
        'algorithm' in value &&
        typeof value.algorithm === 'string' &&
        'fingerprint' in value &&
        typeof value.fingerprint === 'string' &&
        'changed' in value &&
        typeof value.changed === 'boolean' &&
        'previousFingerprints' in value &&
        Array.isArray(value.previousFingerprints) &&
        value.previousFingerprints.every((fingerprint: unknown) => typeof fingerprint === 'string')
      )
        return {
          type: 'host-key',
          host: value.host,
          port: value.port,
          algorithm: value.algorithm,
          fingerprint: value.fingerprint,
          changed: value.changed,
          previousFingerprints: value.previousFingerprints,
        };
      break;
    default:
      return null;
  }
  throw new Error('终端响应无法识别');
}
