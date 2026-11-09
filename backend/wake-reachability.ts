import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import type { DevicePresence, WakeDevice } from './domain/wake.js';
import type { DatabaseService } from './persistence/database.service.js';

export function privateHost(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [a, b, , d] = value.split('.').map(Number);
  return (
    d !== 0 &&
    d !== 255 &&
    (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
  );
}
export type ProbeResult = Pick<DevicePresence, 'state' | 'reason'>;
export type Probe = (ip: string, options: { signal: AbortSignal }) => Promise<ProbeResult>;
export const ping: Probe = (ip, { signal }) =>
  new Promise((resolve) => {
    if (!privateHost(ip)) {
      resolve({ state: 'unknown', reason: 'no_target' });
      return;
    }
    execFile(
      'ping',
      ['-n', '-c', '1', '-W', '2', ip],
      { signal, timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 16384 },
      (error) => {
        resolve(
          !error
            ? { state: 'online', reason: 'reply' }
            : error.code === 1
              ? { state: 'offline', reason: 'no_reply' }
              : { state: 'unknown', reason: 'unavailable' },
        );
      },
    );
  });
interface Flight {
  controller: AbortController;
  promise: Promise<void>;
}
/** One queue per application service, shared by manual and scheduled checks. */
export class Reachability {
  private active = 0;
  private queue: (() => void)[] = [];
  private flights = new Map<string, Flight>();
  private readonly work = new Set<Flight>();
  private rates = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private closed = false;
  constructor(
    private readonly db: DatabaseService,
    private readonly find: (owner: string, id: string) => WakeDevice | undefined,
    private readonly target: (row: WakeDevice) => string,
    private readonly now: () => number,
    private readonly probe: Probe = ping,
  ) {}
  private identity(row: WakeDevice) {
    return JSON.stringify([row.ip || '', row.connectionId, row.mac, this.target(row)]);
  }
  decorate(row: WakeDevice): WakeDevice {
    const stored = this.db.connection
      .prepare('SELECT * FROM wake_presence WHERE device_id=?')
      .get(row.id);
    let presence: DevicePresence | undefined;
    if (stored && stored.target === this.identity(row)) {
      presence = {
        state:
          this.now() - Number(stored.checked_at) > 120000
            ? 'unknown'
            : (stored.state as DevicePresence['state']),
        reason: stored.reason as DevicePresence['reason'],
        checkedAt: new Date(Number(stored.checked_at)).toISOString(),
      };
    }
    return {
      ...row,
      ...(presence ? { presence } : {}),
      checking: this.flights.has(row.id) || this.timers.has(row.id),
    };
  }
  invalidate(id: string) {
    this.cancelTimers(id);
    this.flights.get(id)?.controller.abort();
    this.flights.delete(id);
    this.rates.delete(id);
    this.db.connection.prepare('DELETE FROM wake_presence WHERE device_id=?').run(id);
  }
  private cancelTimers(id: string) {
    this.timers.get(id)?.forEach(clearTimeout);
    this.timers.delete(id);
  }
  check(row: WakeDevice, manual = true): Promise<void> {
    if (this.closed) return Promise.resolve();
    const existing = this.flights.get(row.id);
    if (existing) return existing.promise;
    if (manual && this.now() - (this.rates.get(row.id) ?? -Infinity) < 5000)
      return Promise.resolve();
    this.rates.set(row.id, this.now());
    const controller = new AbortController();
    const identity = this.identity(row),
      target = this.target(row);
    const flight: Flight = { controller, promise: Promise.resolve() };
    this.flights.set(row.id, flight);
    this.work.add(flight);
    flight.promise = (async () => {
      let acquired = false;
      try {
        if (target) {
          await new Promise<void>((resolve) => {
            const start = () => {
              this.active++;
              acquired = true;
              resolve();
            };
            if (this.active < 4) start();
            else this.queue.push(start);
          });
        }
        if (controller.signal.aborted || this.closed) return;
        const result = target
          ? await this.probe(target, { signal: controller.signal }).catch(
              () => ({ state: 'unknown', reason: 'unavailable' }) as const,
            )
          : ({ state: 'unknown', reason: 'no_target' } as const);
        if (controller.signal.aborted || this.closed) return;
        const current = this.find(row.owner, row.id);
        if (!current || this.identity(current) !== identity) return;
        this.db.connection
          .prepare(
            'INSERT INTO wake_presence(device_id,target,state,reason,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET target=excluded.target,state=excluded.state,reason=excluded.reason,checked_at=excluded.checked_at',
          )
          .run(row.id, identity, result.state, result.reason, this.now());
        if (result.state === 'online') this.cancelTimers(row.id);
      } finally {
        if (acquired) {
          this.active--;
          this.queue.shift()?.();
        }
        this.work.delete(flight);
        if (this.flights.get(row.id) === flight) this.flights.delete(row.id);
      }
    })();
    return flight.promise;
  }
  follow(row: WakeDevice) {
    if (this.closed) return;
    this.cancelTimers(row.id);
    const identity = this.identity(row);
    const timers = [5000, 15000, 30000].map((delay) => {
      const timer = setTimeout(() => {
        const pending = this.timers.get(row.id);
        if (!pending) return;
        const remaining = pending.filter((t) => t !== timer);
        if (remaining.length) this.timers.set(row.id, remaining);
        else this.timers.delete(row.id);
        const current = this.find(row.owner, row.id);
        if (!current || this.identity(current) !== identity) {
          this.cancelTimers(row.id);
          return;
        }
        void this.check(current, false).catch(() => {});
      }, delay);
      timer.unref();
      return timer;
    });
    this.timers.set(row.id, timers);
  }
  async close() {
    this.closed = true;
    for (const id of this.timers.keys()) this.cancelTimers(id);
    const flights = [...this.work];
    flights.forEach((f) => f.controller.abort());
    await Promise.allSettled(flights.map((f) => f.promise));
  }
}
