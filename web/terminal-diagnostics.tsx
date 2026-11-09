import type { ConnectionDiagnostic, ConnectionStage } from '../backend/domain/terminal-files.js';
const stages: Record<ConnectionStage, string> = {
  network: '网络连接',
  handshake: 'SSH 握手',
  fingerprint: '主机指纹',
  authentication: '账号认证',
  sftp: 'SFTP 文件服务',
};
// Diagnostic text is plain terminal text; remote control sequences must not be interpreted.
export function createConnectionDiagnostics(write: (line: string) => void) {
  const failures = new Set<string>();
  let lastFailure = '';
  return {
    accept(event: ConnectionDiagnostic) {
      if (event.status !== 'failed') return;
      const message = event.message.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
      lastFailure = event.message;
      const line = `${stages[event.stage]}失败：${message}`;
      if (failures.has(line)) return;
      failures.add(line);
      write(line);
    },
    hasFailure: () => failures.size > 0,
    matchesFailure: (message: string) => !!lastFailure && lastFailure === message,
    reset: () => {
      failures.clear();
      lastFailure = '';
    },
  };
}
