import nodemailer, { type SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { ClaimedDelivery } from '../persistence/notification.repository.js';
import { prepareNotification } from './channels.js';
export type EmailTransportFactory = (options: SMTPTransport.Options) => {
  close(): void;
  sendMail(message: SendMailOptions): Promise<{ accepted: unknown[]; rejected: unknown[] }>;
};
export async function sendEmailNotification(
  job: ClaimedDelivery,
  signal: AbortSignal,
  factory: EmailTransportFactory = nodemailer.createTransport,
) {
  const value = job.options;
  if (!value || value.channel !== 'email')
    return { httpStatus: null, error: '邮箱配置无效', retryable: false };
  let prepared: ReturnType<typeof prepareNotification>;
  try {
    prepared = prepareNotification({ ...job, ...value });
  } catch {
    return { httpStatus: null, error: '邮件内容或配置无效', retryable: false };
  }
  if (signal.aborted) return { httpStatus: null, error: '邮件发送已停止', retryable: false };
  const transport = factory({
    host: value.smtpHost,
    port: value.smtpPort,
    secure: value.smtpSecurity === 'tls',
    requireTLS: value.smtpSecurity === 'starttls',
    ignoreTLS: value.smtpSecurity === 'none',
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: value.smtpUser ? { user: value.smtpUser, pass: job.token } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  let stop: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => {
      transport.close();
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const content = JSON.parse(prepared.body) as { title: string; text: string };
    const to = value.smtpTo.split(',').map((s) => s.trim());
    const result = await Promise.race([
      transport.sendMail({
        from: value.smtpFrom,
        to,
        subject: content.title,
        text: content.text,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
      aborted,
    ]);
    if (result.rejected.length || result.accepted.length !== to.length)
      return {
        httpStatus: null,
        error: '部分收件人被邮件服务器拒绝，请检查地址',
        retryable: false,
      };
    return { httpStatus: 200, retryable: false };
  } catch (error) {
    if (signal.aborted) return { httpStatus: null, error: '邮件发送已停止', retryable: false };
    const e = error as { code?: string; originalCode?: string; responseCode?: number };
    if (e.code === 'EAUTH')
      return { httpStatus: null, error: '邮箱认证失败，请检查账号及授权码', retryable: false };
    if (e.code === 'EENVELOPE')
      return { httpStatus: null, error: '发件人或收件人被邮件服务器拒绝', retryable: false };
    if (
      e.code === 'ETLS' ||
      /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(String(e.originalCode || e.code))
    )
      return { httpStatus: null, error: 'SMTP 证书或 TLS 校验失败', retryable: false };
    if (e.responseCode && e.responseCode >= 500)
      return {
        httpStatus: null,
        error: `邮件服务器拒绝发送（${e.responseCode}）`,
        retryable: false,
      };
    return {
      httpStatus: null,
      error:
        e.responseCode && e.responseCode >= 400 ? '邮件服务器暂时不可用' : 'SMTP 连接失败或超时',
      retryable: true,
    };
  } finally {
    if (stop) signal.removeEventListener('abort', stop);
    transport.close();
  }
}
