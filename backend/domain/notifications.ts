export interface NotificationSettings extends NotificationOptions {
  enabled: boolean;
  url: string;
  token: string;
  condition: 'errors' | 'all';
  scanFailures: boolean;
}
export interface NotificationDelivery {
  id: string;
  templateId: string;
  templateName: string;
  channel: NotificationChannel;
  eventId: string;
  eventType: 'task.result' | 'scan.failed' | 'test' | 'reminder.due';
  name: string;
  status: 'pending' | 'sending' | 'success' | 'failed' | 'cancelled';
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  nextAttemptAt: string | null;
  httpStatus: number | null;
  error: string | null;
}
export interface NotificationDeliveryPage {
  items: NotificationDelivery[];
  total: number;
  page: number;
  pageSize: number;
}

export const NOTIFICATION_CHANNELS = [
  'webhook',
  'wecom',
  'dingtalk',
  'feishu',
  'email',
  'serverchan',
  'bark',
  'inapp',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export interface NotificationOptions {
  channel: NotificationChannel;
  headers: Record<string, string>;
  template: string;
  signingSecret: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls' | 'none';
  smtpUser: string;
  smtpFrom: string;
  smtpTo: string;
  smtpSubject: string;
}
export const DEFAULT_NOTIFICATION_OPTIONS: NotificationOptions = {
  channel: 'webhook',
  headers: {},
  template: '',
  signingSecret: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecurity: 'starttls',
  smtpUser: '',
  smtpFrom: '',
  smtpTo: '',
  smtpSubject: '',
};
export const NOTIFICATION_VARIABLES = [
  'name',
  'status',
  'statusText',
  'eventType',
  'eventId',
  'taskType',
  'startedAt',
  'finishedAt',
  'exitCode',
  'content',
  'dueAt',
] as const;

export type NotificationSettingsInput = Omit<NotificationSettings, keyof NotificationOptions> &
  Partial<NotificationOptions>;

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  webhook: '通用 Webhook',
  wecom: '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书',
  email: '邮箱（SMTP）',
  serverchan: '个人微信（Server酱）',
  bark: '手机推送（Bark）',
  inapp: '应用内通知',
};
export const NOTIFICATION_TOKEN_LABELS: Partial<Record<NotificationChannel, string>> = {
  webhook: 'Bearer Token（可选）',
  email: '授权码／密码',
  serverchan: 'SendKey',
  bark: 'Device Key',
};
export function notificationReady(
  value: Pick<NotificationSettings, 'channel' | 'url' | 'token'> &
    Partial<Pick<NotificationSettings, 'smtpHost' | 'smtpFrom' | 'smtpTo'>>,
): boolean {
  if (!NOTIFICATION_CHANNELS.includes(value.channel)) return false;
  if (value.channel === 'inapp') return true;
  if (value.channel === 'email') return !!(value.smtpHost && value.smtpFrom && value.smtpTo);
  if (['bark', 'serverchan'].includes(value.channel) && !value.token) return false;
  return value.channel === 'serverchan' || !!value.url;
}

export interface NotificationTemplate extends NotificationSettings {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export type NotificationTemplateInput = NotificationSettingsInput & { name: string };
export type NotificationTemplateSummary = Omit<
  NotificationTemplate,
  'token' | 'signingSecret' | 'headers'
> & { ready: boolean };

export interface InboxMessage {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  templateName: string;
  status: 'success';
}
export interface InboxPage {
  items: InboxMessage[];
  total: number;
  page: number;
  pageSize: number;
}
