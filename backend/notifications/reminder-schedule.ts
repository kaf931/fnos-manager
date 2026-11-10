import { defaultChinaCalendar, type ChinaCalendar } from './china-calendar.js';
import { DomainError } from '../errors.js';
import type { ReminderRepeat } from '../domain/reminders.js';
import { nextRun } from '../tasks/model.js';
/** Reminders use the same Beijing wall clock as the existing task scheduler. */
export function nextReminderAt(
  anchor: string,
  repeat: ReminderRepeat,
  after: number,
  weekdays: readonly number[] = [],
  calendar: Pick<ChinaCalendar, 'matches'> = defaultChinaCalendar,
): string | null {
  const start = new Date(anchor);
  if (!Number.isFinite(+start) || !Number.isFinite(after)) throw new Error('提醒时间无效');
  if (repeat === 'custom' || repeat === 'cn-workday' || repeat === 'cn-holiday') {
    if (
      repeat === 'custom' &&
      (!weekdays.length ||
        weekdays.length > 7 ||
        new Set(weekdays).size !== weekdays.length ||
        weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    )
      throw new DomainError('自定义重复请至少选择一个有效的周几');
    const day = 86400000,
      zone = 8 * 3600000;
    const time = (((+start + zone) % day) + day) % day;
    const first = Math.max(Math.floor((+start + zone) / day), Math.floor((after + zone) / day));
    for (let offset = 0; offset < 370; offset++) {
      const candidate = (first + offset) * day + time - zone;
      if (candidate < +start || candidate <= after) continue;
      const date = new Date(candidate + zone);
      const matches =
        repeat === 'custom'
          ? weekdays.includes(date.getUTCDay())
          : calendar.matches(date.toISOString().slice(0, 10), repeat);
      if (matches) return new Date(candidate).toISOString();
    }
    throw new DomainError('无法计算提醒时间');
  }
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
