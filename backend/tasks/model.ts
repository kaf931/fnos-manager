import type { Schedule, TaskDefinition, TaskType } from '../domain/tasks.js';
import { DomainError, inputRecord } from '../errors.js';
export const DEVICE_TASK_ACTIONS: Readonly<
  Partial<Record<string, 'wake' | 'reboot' | 'shutdown'>>
> = {
  'device-wake': 'wake',
  'device-reboot': 'reboot',
  'device-shutdown': 'shutdown',
};
export const TYPE_INFO = [
  {
    id: 'device-wake',
    name: '唤醒设备',
    group: '网络设备',
    method: '网络唤醒 · UDP Magic Packet',
    support: 'device',
  },
  {
    id: 'device-reboot',
    name: '重启设备',
    group: '网络设备',
    method: 'SSH · 固定电源命令',
    support: 'device',
    dangerous: true,
    notice: '按计划重启所选设备，将中断其正在运行的任务。',
  },
  {
    id: 'device-shutdown',
    name: '关闭设备',
    group: '网络设备',
    method: 'SSH · 固定电源命令',
    support: 'device',
    dangerous: true,
    notice: '按计划关闭所选设备，将中断其正在运行的任务。',
  },
  {
    id: 'app',
    name: '程序启停',
    group: '程序与系统控制',
    method: '官方 appcenter-cli',
    support: 'native',
  },
  {
    id: 'docker',
    name: 'Docker 容器控制',
    group: '程序与系统控制',
    method: 'Docker 官方命令',
    support: 'native',
  },
  {
    id: 'reboot',
    name: '重启 NAS',
    group: '程序与系统控制',
    method: '官方 fnos-cli · power.reboot',
    support: 'oauth',
    dangerous: true,
    notice: '将中断这台 NAS 上的所有服务。',
  },
  {
    id: 'trash-clear',
    name: '清空回收站',
    group: '空间清理',
    method: '官方 fnos-cli · file.trash.clear',
    support: 'oauth',
    dangerous: true,
    notice: '永久清空当前授权账号的全部回收站，不包含其他用户或团队回收站。',
  },
  {
    id: 'log-clear',
    name: '清理历史日志',
    group: '空间清理',
    method: '官方 fnos-cli · logger clear',
    support: 'oauth',
    dangerous: true,
    notice: '清空所选模块和级别的全部日志；官方接口不支持按保留天数筛选。',
  },
  {
    id: 'cache-clear',
    name: '清理系统缓存',
    group: '空间清理',
    support: 'unavailable',
    notice: '未确认通用系统缓存的公开清理入口。',
  },
  {
    id: 'backup',
    name: '触发飞牛备份',
    group: '备份与数据保护',
    support: 'unavailable',
    notice: '未确认飞牛备份任务的公开触发入口。',
  },
  {
    id: 'snapshot',
    name: '创建快照',
    group: '备份与数据保护',
    support: 'unavailable',
    notice: '未确认快照应用的公开创建入口。',
  },
  {
    id: 'script',
    name: '自定义脚本',
    group: '自定义',
    method: '/bin/bash',
    support: 'script',
    notice: '脚本以本应用身份执行；飞牛原生版为 root。',
  },
];
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function normalizeSchedule(value: unknown, now = new Date(), allowPast = false): Schedule {
  const s = inputRecord(value, '请选择执行计划');
  if (s.kind === 'interval') {
    if (
      typeof s.minutes !== 'number' ||
      !Number.isInteger(s.minutes) ||
      s.minutes < 1 ||
      s.minutes > 10080
    )
      throw new DomainError('执行间隔需为 1–10080 分钟');
    return { kind: s.kind, minutes: s.minutes };
  }
  if (s.kind === 'daily' || s.kind === 'weekly') {
    if (typeof s.time !== 'string' || !TIME.test(s.time))
      throw new DomainError('时间格式需为 HH:MM');
    if (s.kind === 'daily') return { kind: s.kind, time: s.time };
    if (
      !Array.isArray(s.days) ||
      !s.days.length ||
      s.days.some(
        (day: unknown) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6,
      )
    )
      throw new DomainError('请选择每周执行日');
    return { kind: s.kind, time: s.time, days: [...new Set(s.days as number[])].sort() };
  }
  if (s.kind === 'once') {
    const at =
      typeof s.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.at)
        ? new Date(s.at + ':00+08:00')
        : new Date(String(s.at));
    if (!Number.isFinite(+at) || (!allowPast && at <= now))
      throw new DomainError('单次执行时间必须晚于当前时间');
    return { kind: s.kind, at: at.toISOString() };
  }
  throw new DomainError('不支持的执行计划');
}
export function nextRun(
  schedule: Schedule,
  after: Date | string | number = new Date(),
): string | null {
  const now = new Date(after instanceof Date ? +after : after);
  if (schedule.kind === 'once')
    return new Date(schedule.at) > now ? new Date(schedule.at).toISOString() : null;
  if (schedule.kind === 'interval') return new Date(+now + schedule.minutes * 60000).toISOString();
  const china = new Date(+now + 8 * 3600000),
    [hour, minute] = schedule.time.split(':').map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const local = new Date(
      Date.UTC(
        china.getUTCFullYear(),
        china.getUTCMonth(),
        china.getUTCDate() + offset,
        hour,
        minute,
      ),
    );
    if (schedule.kind === 'weekly' && !schedule.days.includes(local.getUTCDay())) continue;
    const candidate = new Date(+local - 8 * 3600000);
    if (candidate > now) return candidate.toISOString();
  }
  throw new DomainError('无法计算下次执行时间');
}
/** Only repeat operations whose desired final state is idempotent. */
export function repeatableTask(task: Pick<TaskDefinition, 'type' | 'action'>) {
  return (
    task.type === 'device-wake' ||
    ((task.type === 'app' || task.type === 'docker') &&
      (task.action === 'start' || task.action === 'stop'))
  );
}
export function validateTask(value: unknown, now = new Date()): TaskDefinition {
  const input = inputRecord(value, '无效任务'),
    name = String(input.name || '').trim(),
    info = TYPE_INFO.find((type) => type.id === input.type);
  if (!name || name.length > 60 || /[\x00-\x1f]/.test(name))
    throw new DomainError('任务名称需为 1–60 个字符');
  if (!info || info.support === 'unavailable')
    throw new DomainError(info?.notice || '不支持的任务类型');
  if (info.dangerous && input.acknowledged !== true)
    throw new DomainError('请确认此任务的影响范围');
  const task: TaskDefinition = {
    name,
    type: info.id as TaskType,
    enabled: input.enabled === true,
    acknowledged: input.acknowledged === true,
    schedule: normalizeSchedule(input.schedule, now, input.enabled !== true),
    timeoutSeconds: Number(input.timeoutSeconds ?? 300),
  };
  if (
    !Number.isInteger(task.timeoutSeconds) ||
    task.timeoutSeconds < 5 ||
    task.timeoutSeconds > 3600
  )
    throw new DomainError('超时需为 5–3600 秒');
  if (task.type === 'app' || task.type === 'docker') {
    if (input.action !== 'start' && input.action !== 'stop' && input.action !== 'restart')
      throw new DomainError('请选择启动、停止或重启');
    if (
      typeof input.target !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(input.target)
    )
      throw new DomainError('无效程序标识');
    if (['deskicons', 'nodejs_v22'].includes(input.target))
      throw new DomainError('不能控制工具箱自身或其运行时');
    task.target = input.target;
    task.action = input.action;
  }
  if (task.type === 'script') {
    if (
      typeof input.script !== 'string' ||
      !input.script.trim() ||
      Buffer.byteLength(input.script) > 32768 ||
      input.script.includes('\0')
    )
      throw new DomainError('脚本不能为空，且不能超过 32 KB');
    task.script = input.script;
  }
  if (task.type === 'log-clear')
    for (const key of ['level', 'module']) {
      const n = Number(input[key]);
      if (
        input[key] == null ||
        String(input[key]).trim() === '' ||
        !Number.isInteger(n) ||
        n < -1 ||
        n > 65535
      )
        throw new DomainError('请选择有效的日志模块和级别');
      task[key] = n;
    }
  if (DEVICE_TASK_ACTIONS[task.type]) {
    const limit = task.type === 'device-wake' ? 50 : 10;
    if (
      !Array.isArray(input.deviceIds) ||
      !input.deviceIds.length ||
      input.deviceIds.length > limit ||
      input.deviceIds.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id))
    )
      throw new DomainError(`请选择 1–${limit} 台设备`);
    if (typeof input.ownerUid !== 'string' || !/^(?:development|[0-9]{1,10})$/.test(input.ownerUid))
      throw new DomainError('设备任务缺少有效账号');
    task.deviceIds = [...new Set(input.deviceIds as string[])];
    task.ownerUid = input.ownerUid;
    if (task.type !== 'device-wake') {
      if (
        !Array.isArray(input.deviceTargets) ||
        input.deviceTargets.length !== task.deviceIds.length
      )
        throw new DomainError('请确认电源控制目标');
      const targets = input.deviceTargets.map((value) => inputRecord(value, '电源目标配置无效'));
      task.deviceTargets = task.deviceIds.map((id) => {
        const target = targets.find((target) => target.id === id);
        if (
          !target ||
          typeof target.connectionId !== 'string' ||
          typeof target.host !== 'string' ||
          typeof target.username !== 'string' ||
          typeof target.port !== 'number' ||
          !Number.isInteger(target.port) ||
          (target.system !== 'linux' && target.system !== 'windows' && target.system !== 'macos')
        )
          throw new DomainError('电源目标配置无效');
        return {
          id,
          connectionId: target.connectionId,
          system: target.system,
          host: target.host,
          port: target.port,
          username: target.username,
        };
      });
    }
  }
  const retries = input.retryCount ?? 0;
  const missed = input.missedPolicy ?? 'skip';
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0 || retries > 2)
    throw new DomainError('失败重试次数需为 0–2');
  if (missed !== 'skip' && missed !== 'once') throw new DomainError('无效的错过执行策略');
  if ((retries > 0 || missed === 'once') && !repeatableTask(task))
    throw new DomainError('仅唤醒设备、启动或停止程序/容器支持自动重试和补跑');
  task.retryCount = retries;
  task.missedPolicy = missed;
  return task;
}
