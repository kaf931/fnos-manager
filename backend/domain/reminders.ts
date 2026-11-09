export const REMINDER_REPEATS = ['none', 'daily', 'weekly', 'monthly'] as const;
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number];
export interface ReminderInput {
  name: string;
  content: string;
  dueAt: string | null;
  repeat: ReminderRepeat;
  templateIds: string[];
  enabled: boolean;
}
export interface Reminder extends ReminderInput {
  id: string;
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
};
