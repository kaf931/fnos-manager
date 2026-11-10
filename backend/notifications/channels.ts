import { isEmail } from 'class-validator';
import { createHmac } from 'node:crypto';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import {
  DEFAULT_NOTIFICATION_OPTIONS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_VARIABLES,
  type NotificationOptions,
  type NotificationChannel,
} from '../domain/notifications.js';
function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
const forbidden = new Set([
  'host',
  'content-length',
  'content-type',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'expect',
  'trailer',
  'te',
  'x-nas-signature',
  'x-nas-timestamp',
]);
function templateTree(value: unknown, visit: (s: string) => string, depth = 0): unknown {
  if (depth > 32) invalid('消息模板嵌套过深');
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map((v) => templateTree(v, visit, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (/\{\{/.test(k)) invalid('模板变量只能用于 JSON 值');
        return [k, templateTree(v, visit, depth + 1)];
      }),
    );
  return value;
}
function checkVariables(text: string) {
  for (const match of text.matchAll(/\{\{([^{}]*)\}\}/g))
    if (!(NOTIFICATION_VARIABLES as readonly string[]).includes(match[1].trim()))
      invalid('消息模板包含不支持的变量');
}
export function validateNotificationOptions(
  input: Partial<NotificationOptions>,
): NotificationOptions {
  const v = { ...DEFAULT_NOTIFICATION_OPTIONS, ...input };
  if (
    !NOTIFICATION_CHANNELS.includes(v.channel) ||
    typeof v.template !== 'string' ||
    v.template.length > 8000 ||
    typeof v.signingSecret !== 'string' ||
    v.signingSecret.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(v.signingSecret)
  )
    invalid('通知渠道配置无效');
  if (v.signingSecret && !['webhook', 'dingtalk', 'feishu'].includes(v.channel))
    invalid('当前渠道不使用签名密钥');
  if (
    !v.headers ||
    typeof v.headers !== 'object' ||
    Array.isArray(v.headers) ||
    Object.keys(v.headers).length > 20
  )
    invalid('自定义请求头需为最多 20 项的 JSON 对象');
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(v.headers)) {
    const name = key.toLowerCase();
    if (
      forbidden.has(name) ||
      name in headers ||
      key.length > 100 ||
      typeof value !== 'string' ||
      value.length > 4096 ||
      /[^\x20-\x7e\x80-\xff]/.test(value)
    )
      invalid('自定义请求头名称或值无效');
    try {
      validateHeaderName(key);
      validateHeaderValue(key, value);
    } catch {
      invalid('自定义请求头名称或值无效');
    }
    headers[name] = value;
  }
  if (Buffer.byteLength(JSON.stringify(headers)) > 16384) invalid('自定义请求头过大');
  if (v.template) {
    checkVariables(v.template);
    if (v.channel === 'webhook') {
      let body: unknown;
      try {
        body = JSON.parse(v.template);
      } catch {
        invalid('Webhook 消息模板必须是有效 JSON');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        invalid('Webhook 消息模板必须为 JSON 对象');
      templateTree(body, (s) => s);
    }
  }
  if (
    typeof v.smtpHost !== 'string' ||
    v.smtpHost.length > 253 ||
    typeof v.smtpUser !== 'string' ||
    v.smtpUser.length > 320 ||
    typeof v.smtpFrom !== 'string' ||
    v.smtpFrom.length > 320 ||
    typeof v.smtpTo !== 'string' ||
    v.smtpTo.length > 2048 ||
    typeof v.smtpSubject !== 'string' ||
    v.smtpSubject.length > 200 ||
    !['tls', 'starttls', 'none'].includes(v.smtpSecurity) ||
    !Number.isInteger(v.smtpPort) ||
    v.smtpPort < 1 ||
    v.smtpPort > 65535
  )
    invalid('邮箱配置格式无效');
  if (v.channel === 'email') {
    if (
      !/^[a-zA-Z0-9.-]+$/.test(v.smtpHost) ||
      v.smtpHost.startsWith('.') ||
      v.smtpHost.includes('..')
    )
      invalid('请输入 SMTP 主机名或 IP 地址');
    const to = v.smtpTo.split(',').map((s) => s.trim());
    if (
      !isEmail(v.smtpFrom) ||
      !to.length ||
      to.length > 20 ||
      new Set(to.map((x) => x.toLowerCase())).size !== to.length ||
      to.some((s) => !isEmail(s))
    )
      invalid('请输入有效的发件邮箱和收件邮箱，多个地址用逗号分隔');
    if (/[\r\n\x00-\x1f\x7f]/.test(v.smtpUser + v.smtpSubject))
      invalid('邮箱账号或标题包含无效字符');
    if (Object.keys(headers).length) invalid('邮箱渠道不支持 HTTP 请求头');
    checkVariables(v.smtpSubject);
  }
  return {
    channel: v.channel,
    headers,
    template: v.template,
    signingSecret: v.signingSecret,
    smtpHost: v.smtpHost,
    smtpPort: v.smtpPort,
    smtpSecurity: v.smtpSecurity,
    smtpUser: v.smtpUser,
    smtpFrom: v.smtpFrom,
    smtpTo: v.smtpTo,
    smtpSubject: v.smtpSubject,
  };
}
export interface NotificationRequestInput extends Partial<NotificationOptions> {
  url: string;
  token?: string;
  payload: string;
}
const statusNames: Record<string, string> = {
  success: '成功',
  failed: '失败',
  error: '失败',
  timeout: '超时',
  interrupted: '中断',
  cancelled: '已取消',
  test: '测试',
  reminder: '提醒',
};
export function prepareNotification(job: NotificationRequestInput, now = Date.now()) {
  const options = validateNotificationOptions(job);
  const event = JSON.parse(job.payload) as Record<string, unknown>;
  const variables: Record<string, string> = Object.fromEntries(
    NOTIFICATION_VARIABLES.map((key) => [key, event[key] == null ? '' : String(event[key])]),
  );
  variables.statusText = statusNames[String(event.status)] || String(event.status ?? '');
  if (
    event.eventType === 'reminder.due' &&
    typeof event.dueAt === 'string' &&
    Number.isFinite(Date.parse(event.dueAt))
  )
    variables.dueAt =
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(event.dueAt)) + '（北京时间）';
  const render = (text: string) =>
    text.replace(/\{\{([^{}]*)\}\}/g, (_m, key: string) => variables[key.trim()] ?? '');
  const text = render(
    options.template ||
      (event.eventType === 'reminder.due'
        ? 'NAS 管家提醒\n{{name}}\n{{content}}\n提醒时间：{{dueAt}}'
        : 'NAS 管家\n{{name}}\n结果：{{statusText}}\n完成时间：{{finishedAt}}'),
  );
  let url = job.url;
  let body: unknown;
  const headers: Record<string, string> = { ...options.headers };
  switch (options.channel) {
    case 'email':
      body = {
        title: render(options.smtpSubject || 'NAS 管家 · {{name}}').replace(/[\r\n]/g, ' '),
        text,
      };
      break;
    case 'webhook':
      body = options.template ? templateTree(JSON.parse(options.template), render) : event;
      if (job.token && !headers.authorization) headers.authorization = `Bearer ${job.token}`;
      break;
    case 'feishu':
      body = { msg_type: 'text', content: { text } };
      break;
    default:
      body = { msgtype: 'text', text: { content: text } };
  }
  if (
    ['wecom', 'dingtalk', 'feishu'].includes(options.channel) &&
    job.token &&
    !headers.authorization
  )
    headers.authorization = `Bearer ${job.token}`;
  if (options.signingSecret && options.channel === 'dingtalk') {
    const parsed = new URL(url),
      timestamp = String(now);
    parsed.searchParams.set('timestamp', timestamp);
    parsed.searchParams.set(
      'sign',
      createHmac('sha256', options.signingSecret)
        .update(`${timestamp}\n${options.signingSecret}`)
        .digest('base64'),
    );
    url = parsed.href;
  } else if (options.signingSecret && options.channel === 'feishu') {
    const timestamp = String(Math.floor(now / 1000));
    Object.assign(body as object, {
      timestamp,
      sign: createHmac('sha256', `${timestamp}\n${options.signingSecret}`)
        .update('')
        .digest('base64'),
    });
  }
  const encoded = JSON.stringify(body);
  if (
    (options.channel === 'wecom' || options.channel === 'dingtalk') &&
    Buffer.byteLength(text) > 2048
  )
    invalid('机器人文本超过 2048 字节，请缩短模板');
  if (Buffer.byteLength(encoded) > 32768) invalid('通知内容过长，请缩短模板');
  if (options.signingSecret && options.channel === 'webhook') {
    const timestamp = String(Math.floor(now / 1000));
    headers['x-nas-timestamp'] = timestamp;
    headers['x-nas-signature'] =
      'sha256=' +
      createHmac('sha256', options.signingSecret).update(`${timestamp}.${encoded}`).digest('hex');
  }
  headers['content-type'] = 'application/json';
  headers['content-length'] = String(Buffer.byteLength(encoded));
  return { url, headers, body: encoded };
}
export function notificationAcknowledgement(
  channel: NotificationChannel,
  text: string,
): { error?: string; retryable?: boolean } {
  if (channel === 'webhook') return {};
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw 0;
  } catch {
    return { error: '平台返回的确认格式无效' };
  }
  let success: boolean;
  let code: unknown;
  switch (channel) {
    case 'feishu':
      code = body.code ?? body.StatusCode;
      success = code === 0;
      break;
    default:
      code = body.errcode;
      success = code === 0;
  }
  if (success) return {};
  return {
    error:
      typeof code === 'number' && Number.isSafeInteger(code)
        ? `平台拒绝消息（${code}）`
        : '平台未确认消息成功',
  };
}
