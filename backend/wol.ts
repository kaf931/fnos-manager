import { OperationRepository } from './persistence/operation.repository.js';
import { Reachability, privateHost, type Probe } from './wake-reachability.js';
import { OperationService } from './operations/service.js';
import { CONFIG_LIMITS } from './domain/config-limits.js';
import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { isIP } from 'node:net';
import type { DeviceResult, PowerAction, WakeDevice, WakeOptions } from './domain/wake.js';
import { errorInfo, inputRecord } from './errors.js';
import { DatabaseService } from './persistence/database.service.js';
import { WakeRepository } from './persistence/wake.repository.js';
import type { TerminalStore } from './terminal/store.js';
import { WakePower } from './wake-power.js';
const fail = (message: string, status: number = 400) =>
  Object.assign(new Error(message), { status });
export function normalizeMac(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (
    !/^(?:[\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(raw) &&
    !/^([\da-f]{4}\.){2}[\da-f]{4}$/i.test(raw) &&
    !/^([\da-f]{12})$/i.test(raw)
  )
    throw fail('请输入有效的 MAC 地址');
  const hex = raw.replace(/[:.\-]/g, '').toUpperCase();
  if (hex === '000000000000' || parseInt(hex.slice(0, 2), 16) & 1)
    throw fail('MAC 地址必须是设备的单播地址');
  return hex.match(/../g)!.join(':');
}
export function magicPacket(mac: unknown) {
  const bytes = Buffer.from(normalizeMac(mac).replaceAll(':', ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 255), ...Array.from({ length: 16 }, () => bytes)]);
}
export function validateDevice(value: unknown = {}): Omit<WakeDevice, 'id' | 'owner'> {
  const input = inputRecord(value);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) throw fail('设备名称需为 1–80 个字符');
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  if (isIP(address) !== 4) throw fail('请输入有效的 IPv4 广播地址');
  const [a, b] = address.split('.').map(Number);
  if (
    address !== '255.255.255.255' &&
    !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
  )
    throw fail('广播地址须为局域网 IPv4 地址或 255.255.255.255');
  const ip = input.ip === undefined ? '' : typeof input.ip === 'string' ? input.ip.trim() : null;
  if (ip === null || (ip && !privateHost(ip))) throw fail('设备 IP 须为局域网单播 IPv4 地址');
  const port = input.port ?? 9;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
    throw fail('端口需为 1–65535 的整数');
  const connectionId = input.connectionId ?? null;
  if (
    connectionId !== null &&
    (typeof connectionId !== 'string' || !/^[a-f0-9]{24}$/.test(connectionId))
  )
    throw fail('请选择有效的 SSH 连接');
  const system = input.system ?? 'linux';
  if (system !== 'linux' && system !== 'windows' && system !== 'macos')
    throw fail('请选择目标操作系统');
  return {
    ...(ip ? { ip } : {}),
    name,
    mac: normalizeMac(input.mac),
    address,
    port,
    connectionId,
    system,
  };
}
export function sendMagicPacket(device: WakeDevice, { signal }: WakeOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let done = false;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      try {
        socket.close();
      } catch {}
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(fail('发送唤醒包超时，请检查网络', 503)), 3000);
    const cancel = () => finish(fail('任务已中断'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    socket.once('error', (error) => finish(fail('无法发送唤醒包：' + error.message, 503)));
    socket.bind(0, () => {
      if (done) return;
      try {
        socket.setBroadcast(true);
        socket.send(magicPacket(device.mac), device.port, device.address, (error) =>
          finish(error ? fail('发送唤醒包失败：' + error.message, 503) : null),
        );
      } catch (error) {
        finish(error);
      }
    });
  });
}
export class WakeService {
  declare terminalStore: TerminalStore | undefined;
  declare power: WakePower | null;
  declare dataDir: string;
  readonly repository: WakeRepository;
  readonly database: DatabaseService;
  readonly audit: OperationService;
  declare send: typeof sendMagicPacket;
  declare now: () => number;
  declare pending: Promise<unknown>;
  declare rates: Map<string, number>;
  declare active: Set<string>;
  readonly reachability: Reachability;
  private closed = false;
  private closing?: Promise<void>;
  private readonly shutdown = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  get rows() {
    return this.repository.list();
  }

  constructor({
    dataDir,
    database,
    operations,
    send = sendMagicPacket,
    now = () => Date.now(),
    terminalStore,
    power,
    probe,
  }: {
    dataDir: string;
    database?: DatabaseService;
    operations?: OperationService;
    send?: typeof sendMagicPacket;
    now?: () => number;
    terminalStore?: TerminalStore;
    power?: WakePower;
    probe?: Probe;
  }) {
    this.terminalStore = terminalStore;
    this.power = power || (terminalStore ? new WakePower(terminalStore) : null);
    this.dataDir = dataDir;
    this.database = database ?? new DatabaseService(dataDir);
    this.audit = operations ?? new OperationService(new OperationRepository(this.database));
    this.repository = new WakeRepository(this.database);
    this.send = send;
    this.now = now;
    this.pending = Promise.resolve();
    this.rates = new Map<string, number>();
    this.active = new Set<string>();
    this.reachability = new Reachability(
      this.database,
      (owner, id) => this.repository.find(owner, id),
      (row) => {
        if (row.ip) return privateHost(row.ip) ? row.ip : '';
        try {
          const connection = row.connectionId
            ? this.terminalStore?.get(row.owner, row.connectionId)
            : undefined;
          return connection?.kind === 'remote' && privateHost(connection.host)
            ? connection.host
            : '';
        } catch {
          return '';
        }
      },
      now,
      probe,
    );
  }
  async init() {
    return this;
  }
  list(owner: string) {
    return this.rows
      .filter((r) => r.owner === owner)
      .map((row) => this.reachability.decorate(row))
      .map(({ owner, ...r }) => structuredClone(r));
  }
  get(owner: string, id: string) {
    const row = this.repository.find(owner, id);
    if (!row) throw fail('设备不存在', 404);
    return row;
  }
  change<T>(fn: () => T): Promise<T> {
    const task = this.pending.then(() => this.database.transaction(fn));
    this.pending = task.catch(() => {});
    return task;
  }
  async save(owner: string, input: unknown, id?: string) {
    if (this.closed) throw fail('网络唤醒服务已关闭', 503);
    const valid = validateDevice(input);
    if (valid.connectionId) {
      if (!this.terminalStore) throw fail('SSH 服务不可用');
      const connection = this.terminalStore.get(owner, valid.connectionId);
      if (connection.kind !== 'remote' || !connection.hasCredentials)
        throw fail('请选择已保存认证信息的远程 SSH 连接');
    }
    const row = await this.change(() => {
      const rows = this.repository.list();
      let row: WakeDevice;
      if (id) {
        const existing = this.repository.find(owner, id);
        if (!existing) throw fail('设备不存在', 404);
        row = existing;
        if (this.active.has(id)) throw fail('设备正在发送唤醒包，请稍后重试', 409);
      } else {
        if (
          rows.filter((r) => r.owner === owner).length >= CONFIG_LIMITS.devices ||
          rows.length >= CONFIG_LIMITS.totalDevices
        )
          throw fail('已达到设备数量上限', 409);
        row = { id: randomBytes(12).toString('hex'), owner, ...valid };
      }
      this.reachability.invalidate(row.id);
      delete row.ip;
      Object.assign(row, valid, {
        updatedAt: new Date(this.now()).toISOString(),
      });
      this.repository.save(row);
      return row;
    });
    const { owner: _, ...result } = row;
    return result;
  }
  async remove(owner: string, id: string) {
    if (this.closed) throw fail('网络唤醒服务已关闭', 503);
    await this.change(() => {
      this.get(owner, id);
      if (this.active.has(id)) throw fail('设备正在发送唤醒包，请稍后重试', 409);
      this.reachability.invalidate(id);
      this.repository.remove(owner, id);
    });
  }

  checkMany(owner: string, value: unknown) {
    return this.operation({}, async () => {
      const input = inputRecord(value);
      if (
        !Array.isArray(input.ids) ||
        !input.ids.length ||
        input.ids.length > 50 ||
        input.ids.some((id) => typeof id !== 'string' || id.length > 64)
      )
        throw fail('请选择 1–50 台设备');
      const ids = [...new Set(input.ids as string[])];
      const rows = ids.map((id) => this.get(owner, id));
      await Promise.all(rows.map((row) => this.reachability.check(row)));
      return this.list(owner).filter((row) => ids.includes(row.id));
    });
  }

  private operation<T>(
    options: WakeOptions,
    run: (options: WakeOptions) => Promise<T>,
  ): Promise<T> {
    if (this.closed) return Promise.reject(fail('网络唤醒服务已关闭', 503));
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.shutdown.signal])
      : this.shutdown.signal;
    const task = run({ ...options, signal });
    this.operations.add(task);
    void task.finally(() => this.operations.delete(task)).catch(() => {});
    return task;
  }
  wakeMany(owner: string, value: unknown = {}, options: WakeOptions = {}) {
    return this.operation(options, (next) => this.runWakeMany(owner, value, next));
  }
  private async runWakeMany(
    owner: string,
    value: unknown = {},
    { signal, scheduled = false }: WakeOptions = {},
  ) {
    const input = inputRecord(value);
    if (signal?.aborted) throw fail('任务已中断');
    if (
      !Array.isArray(input.ids) ||
      !input.ids.length ||
      input.ids.length > 50 ||
      input.ids.some((id: unknown) => typeof id !== 'string')
    )
      throw fail('请选择 1–50 台设备');
    const ids = [...new Set(input.ids as string[])],
      devices = ids.map((id) => structuredClone(this.get(owner, id))),
      now = this.now();
    if (
      (!scheduled && now - (this.rates.get(owner) ?? -Infinity) < 2000) ||
      ids.some((id) => this.active.has(id))
    )
      throw fail('操作过于频繁，请稍后重试', 429);
    if (this.active.size >= 4) throw fail('正在发送其他唤醒包，请稍后重试', 503);
    if (!scheduled) this.rates.set(owner, now);
    for (const id of ids) this.active.add(id);
    const results = new Array<DeviceResult>(devices.length);
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, devices.length) }, async () => {
          for (let index; (index = cursor++) < devices.length;) {
            const row = devices[index];
            try {
              if (signal?.aborted) throw fail('任务已中断');
              await this.send(row, { signal });
              const sentAt = new Date(this.now()).toISOString();
              await this.change(() => {
                const current = this.repository.find(owner, row.id);
                if (current) this.repository.save({ ...current, lastSentAt: sentAt });
              });
              this.reachability.follow(row);
              results[index] = {
                id: row.id,
                name: row.name,
                success: true,
                sentAt,
              };
            } catch (error) {
              results[index] = {
                id: row.id,
                name: row.name,
                success: false,
                error: errorInfo(error).message || '发送失败',
              };
            }
          }
        }),
      );
      return {
        results,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      };
    } finally {
      for (const id of ids) this.active.delete(id);
    }
  }
  controlMany(owner: string, value: unknown = {}, options: WakeOptions = {}) {
    return this.operation(options, (next) => this.runControlMany(owner, value, next));
  }
  private async runControlMany(
    owner: string,
    value: unknown = {},
    { signal, scheduled = false }: WakeOptions = {},
  ) {
    const input = inputRecord(value);
    if (signal?.aborted) throw fail('任务已中断');
    if ((input.action !== 'shutdown' && input.action !== 'reboot') || input.confirmed !== true)
      throw fail('请确认关机或重启操作');
    if (
      !Array.isArray(input.ids) ||
      !input.ids.length ||
      input.ids.length > 10 ||
      input.ids.some((id: unknown) => typeof id !== 'string')
    )
      throw fail('电源操作一次请选择 1–10 台设备');
    if (!this.power) throw fail('SSH 电源控制不可用');
    const action: PowerAction = input.action;
    const power = this.power;
    const devices = [...new Set(input.ids as string[])].map((id) =>
        structuredClone(this.get(owner, id)),
      ),
      prepared = devices.map((row) => power.prepare(owner, row, action)),
      now = this.now();
    if (input.targets !== undefined) {
      if (!Array.isArray(input.targets) || input.targets.length !== devices.length)
        throw fail('目标确认已失效，请重新选择设备');
      for (let i = 0; i < devices.length; i++) {
        const row = devices[i],
          c = prepared[i].connection,
          target = input.targets.map((value) => inputRecord(value)).find((t) => t.id === row.id);
        if (
          !target ||
          !c ||
          target.connectionId !== row.connectionId ||
          target.system !== (row.system || 'linux') ||
          target.host !== c.host ||
          target.port !== c.port ||
          target.username !== c.username
        )
          throw fail('设备或 SSH 目标已变化，请重新打开批量管理后确认');
      }
    }
    if (
      (!scheduled && now - (this.rates.get(owner) ?? -Infinity) < 2000) ||
      devices.some((row) => this.active.has(row.id))
    )
      throw fail('操作过于频繁，请稍后重试', 429);
    if (this.active.size >= 4) throw fail('正在处理其他设备，请稍后重试', 503);
    if (!scheduled) this.rates.set(owner, now);
    for (const row of devices) this.active.add(row.id);
    const results = new Array<DeviceResult>(devices.length);
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, devices.length) }, async () => {
          for (let i; (i = cursor++) < devices.length;) {
            const row = devices[i];
            try {
              if (signal?.aborted) throw fail('任务已中断');
              await this.audit.run(
                owner,
                action === 'reboot' ? 'device.reboot' : 'device.shutdown',
                row.name,
                () => power.execute(owner, row, action, prepared[i], { signal }),
              );
              const sentAt = new Date(this.now()).toISOString();
              await this.change(() => {
                const current = this.repository.find(owner, row.id);
                if (current) this.repository.save({ ...current, lastControl: { action, sentAt } });
              }).catch(() => console.error('电源操作已发送，设备状态保存失败'));
              results[i] = {
                id: row.id,
                name: row.name,
                success: true,
                sentAt,
              };
            } catch (error) {
              results[i] = {
                id: row.id,
                name: row.name,
                success: false,
                error: errorInfo(error).message || '执行失败',
              };
            }
          }
        }),
      );
      return {
        action: input.action,
        results,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      };
    } finally {
      for (const row of devices) this.active.delete(row.id);
    }
  }
  close() {
    if (!this.closing) {
      this.closed = true;
      this.shutdown.abort();
      this.power?.close();
      this.closing = (async () => {
        await this.reachability.close();
        await Promise.allSettled([...this.operations]);
        await this.pending;
      })();
    }
    return this.closing;
  }
  async wake(owner: string, id: string) {
    const { results } = await this.wakeMany(owner, { ids: [id] }),
      result = results[0];
    if (!result.success) throw fail(result.error, 503);
    return { message: '唤醒包已发送', sentAt: result.sentAt };
  }
}
