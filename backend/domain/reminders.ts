export const REMINDER_REPEATS = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'cn-workday',
  'cn-holiday',
  'custom',
] as const;
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number];
export interface ReminderInput {
  name: string;
  content: string;
  dueAt: string | null;
  repeat: ReminderRepeat;
  weekdays?: number[];
  templateIds: string[];
  enabled: boolean;
}
export interface Reminder extends ReminderInput {
  id: string;
  weekdays: number[];
  status: 'open' | 'completed';
  nextAt: string | null;
  lastFiredAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export const REMINDER_REPEAT_LABELS: Record<ReminderRepeat, string> = {
  none: '单次提醒',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  'cn-workday': '法定工作日（中国大陆）',
  'cn-holiday': '法定节假日（中国大陆）',
  custom: '自定义',
};

export const REMINDER_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export const REMINDER_WEEKDAY_LABELS = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
] as const;
export function reminderRepeatLabel(reminder: Pick<ReminderInput, 'repeat' | 'weekdays'>) {
  if (reminder.repeat !== 'custom') return REMINDER_REPEAT_LABELS[reminder.repeat];
  const days = REMINDER_WEEKDAYS.filter((day) => reminder.weekdays?.includes(day));
  const ranges: number[][] = [];
  for (const day of days) {
    const previous = ranges.at(-1);
    if (previous && (day || 7) === (previous.at(-1)! || 7) + 1) previous.push(day);
    else ranges.push([day]);
  }
  return ranges
    .flatMap((range) =>
      range.length >= 3
        ? [REMINDER_WEEKDAY_LABELS[range[0]] + '至' + REMINDER_WEEKDAY_LABELS[range.at(-1)!]]
        : range.map((day) => REMINDER_WEEKDAY_LABELS[day]),
    )
    .join('、');
}
