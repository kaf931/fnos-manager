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
  'telegram',
  'bark',
  'pushplus',
  'serverchan',
  'wxpusher',
  'ntfy',
  'gotify',
  'slack',
  'discord',
  'email',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export interface NotificationOptions {
  channel: NotificationChannel;
  headers: Record<string, string>;
  template: string;
  signingSecret: string;
  telegramChatId: string;
  topic: string;
  recipients: string;
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
  telegramChatId: '',
  topic: '',
  recipients: '',
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
  telegram: 'Telegram',
  bark: 'Bark',
  pushplus: 'PushPlus',
  serverchan: 'Server酱',
  wxpusher: 'WxPusher',
  ntfy: 'ntfy',
  gotify: 'Gotify',
  slack: 'Slack',
  discord: 'Discord',
  email: '邮箱（SMTP）',
};
export const NOTIFICATION_TOKEN_LABELS: Partial<Record<NotificationChannel, string>> = {
  webhook: 'Bearer Token（可选）',
  telegram: 'Bot Token',
  bark: 'Device Key',
  pushplus: 'Token',
  serverchan: 'SendKey',
  wxpusher: 'SPT / AppToken',
  ntfy: 'Access Token（可选）',
  gotify: '应用 Token',
  email: '授权码／密码',
};
export const NOTIFICATION_DEFAULT_URLS: Partial<Record<NotificationChannel, string>> = {
  bark: 'https://api.day.app/push',
  ntfy: 'https://ntfy.sh/',
};
export const NOTIFICATION_FIXED_ENDPOINTS: readonly NotificationChannel[] = [
  'telegram',
  'pushplus',
  'serverchan',
  'wxpusher',
];
export function notificationReady(
  value: Pick<
    NotificationSettings,
    'channel' | 'url' | 'token' | 'telegramChatId' | 'topic' | 'recipients'
  > &
    Partial<Pick<NotificationSettings, 'smtpHost' | 'smtpFrom' | 'smtpTo'>>,
): boolean {
  if (value.channel === 'email') return !!(value.smtpHost && value.smtpFrom && value.smtpTo);
  if (
    ['telegram', 'bark', 'pushplus', 'serverchan', 'wxpusher', 'gotify'].includes(value.channel) &&
    !value.token
  )
    return false;
  if (value.channel === 'telegram' && !value.telegramChatId) return false;
  if (value.channel === 'ntfy' && !value.topic) return false;
  if (value.channel === 'wxpusher' && value.token.startsWith('AT_') && !value.recipients.trim())
    return false;
  return NOTIFICATION_FIXED_ENDPOINTS.includes(value.channel) || !!value.url;
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
>;
