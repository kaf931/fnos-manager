import type { TaskDefinition } from '../domain/tasks.js';
import type { DeviceResult, PowerTarget } from '../domain/wake.js';
import { DomainError, errorInfo, inputRecord } from '../errors.js';
import type { PublicConnection } from '../terminal/store.js';
import type { WakeService } from '../wol.js';
import { DEVICE_TASK_ACTIONS } from './model.js';
interface DeviceOption {
  id: string;
  name: string;
  mac: string;
  available: boolean;
  description: string;
  target?: PowerTarget;
}
const sameTarget = (a: Record<string, unknown> | undefined, b: PowerTarget | undefined) =>
  (['id', 'connectionId', 'system', 'host', 'port', 'username'] as const).every(
    (key) => a?.[key] === b?.[key],
  );
export function deviceTaskOptions(wake: WakeService, owner: string, type: string): DeviceOption[] {
  const action = DEVICE_TASK_ACTIONS[type];
  if (!action) throw new DomainError('不支持的设备任务');
  return wake.list(owner).map((row) => {
    let c: PublicConnection | null | undefined;
    try {
      c = row.connectionId ? wake.terminalStore?.get(owner, row.connectionId) : null;
    } catch {}
    const ready = c?.kind === 'remote' && c.hasCredentials ? c : undefined;
    return {
      id: row.id,
      name: row.name,
      mac: row.mac,
      available: action === 'wake' || !!ready,
      description:
        action === 'wake'
          ? row.mac
          : ready
            ? `${ready.username}@${ready.host}:${ready.port}`
            : '未绑定可用的 SSH 连接',
      ...(ready
        ? {
            target: {
              id: row.id,
              connectionId: row.connectionId!,
              system: row.system || 'linux',
              host: ready.host,
              port: ready.port,
              username: ready.username,
            },
          }
        : {}),
    };
  });
}
export function resolveTaskTargets(wake: WakeService, owner: string, ids: unknown, type: string) {
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string'))
    throw new DomainError('请选择设备');
  const options = deviceTaskOptions(wake, owner, type);
  return [...new Set(ids as string[])].map((id) => {
    wake.get(owner, id);
    const row = options.find((row) => row.id === id);
    if (!row?.available) throw new DomainError('设备未绑定可用的 SSH 连接');
    return row;
  });
}
export function checkConfirmedTargets(stored: unknown, current: DeviceOption[]) {
  if (
    !Array.isArray(stored) ||
    stored.length !== current.length ||
    current.some(
      (row) =>
        !sameTarget(
          stored.map((value) => inputRecord(value)).find((t) => t.id === row.id),
          row.target,
        ),
    )
  )
    throw new DomainError('SSH 目标已变化，请编辑任务重新确认');
}
export async function runDeviceTask(
  task: TaskDefinition,
  { wake, signal }: { wake: WakeService; signal?: AbortSignal },
) {
  const action = DEVICE_TASK_ACTIONS[task.type],
    abort = new AbortController();
  let timedOut = false;
  const stop = () => abort.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, task.timeoutSeconds * 1000);
  const results: DeviceResult[] = [];
  try {
    for (const id of task.deviceIds ?? []) {
      let name = id;
      try {
        if (abort.signal.aborted)
          throw new DomainError(timedOut ? '任务超时，未继续执行' : '任务已中断，未继续执行');
        const row = resolveTaskTargets(wake, task.ownerUid!, [id], task.type)[0];
        name = row.name;
        if (action !== 'wake')
          checkConfirmedTargets(
            (task.deviceTargets ?? []).filter((t) => t.id === id),
            [row],
          );
        const response =
          action === 'wake'
            ? await wake.wakeMany(
                task.ownerUid!,
                { ids: [id] },
                { signal: abort.signal, scheduled: true },
              )
            : await wake.controlMany(
                task.ownerUid!,
                { ids: [id], action, confirmed: true, targets: [row.target] },
                { signal: abort.signal, scheduled: true },
              );
        const result = response.results[0];
        results.push({
          id,
          name,
          ...(result.success
            ? { success: true, sentAt: result.sentAt }
            : { success: false, error: result.error }),
        });
      } catch (error) {
        results.push({ id, name, success: false, error: errorInfo(error).message });
      }
    }
    const label = { wake: '唤醒包', reboot: '重启命令', shutdown: '关机命令' }[action ?? 'wake'],
      lines = results.map((row) => `${row.name}：${row.success ? label + '已提交' : row.error}`);
    return {
      code: results.every((r) => r.success) ? 0 : 1,
      timedOut,
      stdout: lines.join('\n'),
      stderr: results
        .filter((r) => !r.success)
        .map((r) => `${r.name}：${r.success ? '' : r.error}`)
        .join('\n'),
      deviceResults: results,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
