import type { ReminderRepeat } from '../domain/reminders.js';
import { nextRun } from '../tasks/model.js';
/** Reminders use the same Beijing wall clock as the existing task scheduler. */
export function nextReminderAt(
  anchor: string,
  repeat: ReminderRepeat,
  after: number,
): string | null {
  const start = new Date(anchor);
  if (!Number.isFinite(+start) || !Number.isFinite(after)) throw new Error('提醒时间无效');
  if (+start > after) return start.toISOString();
  if (repeat === 'none') return null;
  const local = new Date(+start + 8 * 3600000),
    time = local.toISOString().slice(11, 16);
  if (repeat === 'daily' || repeat === 'weekly') {
    const offset = local.getUTCSeconds() * 1000 + local.getUTCMilliseconds();
    const next = nextRun(
      repeat === 'daily'
        ? { kind: 'daily', time }
        : { kind: 'weekly', time, days: [local.getUTCDay()] },
      after - offset,
    );
    return next ? new Date(Date.parse(next) + offset).toISOString() : null;
  }
  const current = new Date(after + 8 * 3600000);
  for (let offset = 0; offset < 14; offset++) {
    const month = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1));
    const last = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const next =
      Date.UTC(
        month.getUTCFullYear(),
        month.getUTCMonth(),
        Math.min(local.getUTCDate(), last),
        local.getUTCHours(),
        local.getUTCMinutes(),
        local.getUTCSeconds(),
        local.getUTCMilliseconds(),
      ) -
      8 * 3600000;
    if (next > after) return new Date(next).toISOString();
  }
  throw new Error('无法计算提醒时间');
}
