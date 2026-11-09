import { OperationRejected } from './operations/outcome.js';
import type { Client as SshClient } from 'ssh2';
import ssh2 from 'ssh2';
import type { PowerAction, WakeDevice } from './domain/wake.js';
import { DomainError } from './errors.js';
import type { TerminalStore } from './terminal/store.js';
const { Client, utils } = ssh2;
const fail = (message: string) => new DomainError(message);
export function powerCommand(system: string, action: string, username: string) {
  if (!['shutdown', 'reboot'].includes(action)) throw fail('不支持的电源操作');
  if (system === 'windows')
    return action === 'shutdown' ? 'shutdown.exe /s /t 0' : 'shutdown.exe /r /t 0';
  const sudo = username === 'root' ? '' : 'sudo -n -- ';
  if (system === 'linux')
    return sudo + 'systemctl ' + (action === 'shutdown' ? 'poweroff' : 'reboot');
  if (system === 'macos')
    return sudo + '/sbin/shutdown ' + (action === 'shutdown' ? '-h' : '-r') + ' now';
  throw fail('请选择目标设备的操作系统');
}
export class WakePower {
  declare store: TerminalStore;
  declare clientFactory: () => SshClient;
  declare timeout: number;
  declare active: Set<SshClient>;
  closed = false;

  constructor(
    store: TerminalStore,
    {
      clientFactory = () => new Client(),
      timeout = 12000,
    }: { clientFactory?: () => SshClient; timeout?: number } = {},
  ) {
    this.store = store;
    this.clientFactory = clientFactory;
    this.timeout = timeout;
    this.active = new Set<SshClient>();
  }
  prepare(owner: string, device: WakeDevice, action: PowerAction) {
    if (!device.connectionId) throw fail('请先关联 SSH 连接');
    const connection = this.store.get(owner, device.connectionId);
    if (connection.kind !== 'remote') throw fail('电源控制仅支持远程 SSH 连接');
    const credentials = this.store.getCredentials(owner, connection.id, connection);
    if (!credentials) throw fail('请先在远程连接保存认证信息');
    return {
      connection,
      credentials,
      command: powerCommand(device.system || 'linux', action, connection.username),
    };
  }
  execute(
    owner: string,
    device: WakeDevice,
    action: PowerAction,
    prepared?: ReturnType<WakePower['prepare']>,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    if (signal?.aborted) return Promise.reject(fail('任务已中断'));
    if (this.closed) return Promise.reject(fail('电源控制服务已关闭'));
    const { connection: c, credentials, command } = prepared || this.prepare(owner, device, action);
    return new Promise<void>((resolve, reject) => {
      const client = this.clientFactory();
      let done = false,
        reason = '';
      this.active.add(client);
      const finish = (error?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        this.active.delete(client);
        client.destroy();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(fail('SSH 操作超时，无法确认执行结果，请检查设备状态')),
        this.timeout,
      );
      const cancel = () => finish(fail('任务已中断，无法确认设备状态'));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      client.on('error', (error: Error & { level?: string }) =>
        finish(
          fail(
            reason ||
              (error.level === 'client-authentication'
                ? 'SSH 认证失败，请检查保存的认证信息'
                : 'SSH 连接失败，请检查目标设备和端口'),
          ),
        ),
      );
      client.on('close', () =>
        finish(fail(reason || 'SSH 连接已断开，无法确认执行结果，请检查设备状态')),
      );
      client.on('ready', () => {
        if (done) return;
        client.exec(command, (error, stream) => {
          if (error) return finish(fail('无法执行电源命令'));
          let code: number | null = null,
            output = '';
          const collect = (data: Buffer) => {
            output = (output + data.toString()).slice(-4096);
          };
          stream.on('data', collect);
          stream.stderr?.on('data', collect);
          stream.on('error', () => finish(fail('电源命令通道中断，无法确认执行结果')));
          stream.on('exit', (value: number) => {
            code = Number.isInteger(value) && value >= 0 ? value : null;
          });
          stream.on('close', () => {
            if (code === 0) finish();
            else if (code !== null)
              finish(
                new OperationRejected(
                  `电源命令执行失败（${code}），请检查账号权限或免密 sudo 配置${/sudo|permission|denied|password/i.test(output) ? '，账号权限不足' : ''}`,
                ),
              );
            else finish(fail('连接已断开，无法确认电源命令执行结果'));
          });
        });
      });
      try {
        client.connect({
          host: c.host,
          port: c.port,
          username: c.username,
          readyTimeout: 8000,
          ...(credentials.method === 'password'
            ? { password: credentials.password }
            : {
                privateKey: credentials.privateKey,
                passphrase: credentials.passphrase || undefined,
              }),
          hostVerifier: (key: Buffer) => {
            const parsed = utils.parseKey(key);
            const saved =
              parsed instanceof Error
                ? null
                : this.store.getHostKey(owner, c.host, c.port, parsed.type);
            if (saved?.key === key.toString('base64')) return true;
            reason = '主机指纹未确认或已变化，请先通过远程连接中的 SSH 连接并核对指纹';
            return false;
          },
        });
      } catch {
        finish(fail('无法建立 SSH 连接，请检查连接配置'));
      }
    });
  }
  close() {
    this.closed = true;
    for (const client of this.active) client.destroy();
  }
}
