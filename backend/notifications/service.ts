import { CalendarUnavailableError } from './china-calendar.js';
import type { ReminderInput } from '../domain/reminders.js';
import type { ReminderRepository } from '../persistence/reminder.repository.js';
import { sendEmailNotification } from './email.js';
import { prepareNotification, notificationAcknowledgement } from './channels.js';
import type {
  NotificationSettingsInput,
  NotificationTemplateInput,
} from '../domain/notifications.js';
import http from 'node:http';
import https from 'node:https';
import {
  NotificationRepository,
  type ClaimedDelivery,
} from '../persistence/notification.repository.js';
export type NotificationSender = (
  job: ClaimedDelivery,
  signal: AbortSignal,
) => Promise<number | { httpStatus: number | null; error?: string; retryable?: boolean }>;
export const sendNotification: NotificationSender = (job, signal) =>
  job.options?.channel === 'email'
    ? sendEmailNotification(job, signal)
    : new Promise((resolve, reject) => {
        let prepared: ReturnType<typeof prepareNotification>;
        try {
          prepared = prepareNotification({ ...job, ...job.options });
        } catch {
          resolve({ httpStatus: null, error: '通知内容或配置无效，请检查模板与渠道设置' });
          return;
        }
        const url = new URL(prepared.url);
        const request = (url.protocol === 'https:' ? https : http).request(
          url,
          { method: 'POST', signal, headers: prepared.headers },
          (response) => {
            const status = response.statusCode ?? 0;
            if (
              (job.options?.channel ?? 'webhook') === 'webhook' ||
              status < 200 ||
              status >= 300
            ) {
              resolve(status);
              response.destroy();
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 65536) {
                resolve({ httpStatus: status, error: '平台响应过大，未确认消息成功' });
                response.destroy();
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () =>
              resolve({
                httpStatus: status,
                ...notificationAcknowledgement(
                  job.options!.channel,
                  Buffer.concat(chunks).toString('utf8'),
                ),
              }),
            );
            response.on('error', reject);
            response.on('aborted', () => reject(new Error('response aborted')));
          },
        );
        const timeout = setTimeout(() => request.destroy(new Error('timeout')), 10000);
        request.on('close', () => clearTimeout(timeout));
        request.on('error', reject);
        request.end(prepared.body);
      });

export class NotificationService {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private stopped = false;
  constructor(
    readonly repository: NotificationRepository,
    private readonly send: NotificationSender = sendNotification,
    private readonly reminders?: ReminderRepository,
  ) {}
  private reminderRepository() {
    if (!this.reminders) throw Object.assign(new Error('提醒服务不可用'), { status: 503 });
    return this.reminders;
  }
  listInbox(owner: string, page = 1, pageSize = 10, filter: 'all' | 'unread' = 'all', q = '') {
    return this.repository.inbox(owner, page, pageSize, filter, q);
  }
  inboxUnread(owner: string) {
    return { count: this.repository.inboxUnread(owner) };
  }
  readInbox(owner: string, ids?: string[]) {
    return this.repository.readInbox(owner, ids);
  }
  batchReminders(owner: string, ids: string[], action: 'complete' | 'pause' | 'delete') {
    return this.reminderRepository().batch(owner, ids, action);
  }
  listReminders(owner: string) {
    return this.reminderRepository().list(owner);
  }
  private async withCalendar<T>(operation: () => T): Promise<T> {
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof CalendarUnavailableError)) throw error;
      await this.reminderRepository().calendar.refresh(error.year, true);
      if (this.stopped) throw Object.assign(new Error('提醒服务正在停止'), { status: 503 });
      this.reminderRepository().refreshCalendarSchedules();
      return operation();
    }
  }
  createReminder(owner: string, input: ReminderInput) {
    return this.withCalendar(() => this.reminderRepository().create(owner, input));
  }
  updateReminder(owner: string, id: string, input: ReminderInput) {
    return this.withCalendar(() => this.reminderRepository().update(owner, id, input));
  }
  enableReminder(owner: string, id: string, enabled: boolean) {
    return this.withCalendar(() => this.reminderRepository().setEnabled(owner, id, enabled));
  }
  completeReminder(owner: string, id: string, completed: boolean) {
    return this.reminderRepository().complete(owner, id, completed);
  }
  deleteReminder(owner: string, id: string) {
    return this.reminderRepository().remove(owner, id);
  }
  templateOrder(owner: string) {
    return this.repository.templateOrder(owner);
  }
  saveTemplateOrder(owner: string, keys: string[]) {
    return this.repository.saveTemplateOrder(owner, keys);
  }
  listTemplates(owner: string) {
    return this.repository.listTemplates(owner);
  }
  createTemplate(owner: string, input: NotificationTemplateInput) {
    return this.repository.createTemplate(owner, input);
  }
  getTemplate(owner: string, id: string) {
    return this.repository.getTemplate(owner, id);
  }
  updateTemplate(owner: string, id: string, input: NotificationTemplateInput) {
    return this.repository.updateTemplate(owner, id, input);
  }
  setTemplateEnabled(owner: string, id: string, enabled: boolean) {
    return this.repository.setTemplateEnabled(owner, id, enabled);
  }
  deleteTemplate(owner: string, id: string) {
    return this.repository.deleteTemplate(owner, id);
  }
  testTemplate(owner: string, id: string) {
    return this.repository.enqueueTest(owner, id);
  }
  getSettings(owner: string) {
    return this.repository.getSettings(owner);
  }
  saveSettings(owner: string, input: NotificationSettingsInput) {
    return this.repository.saveSettings(owner, input);
  }
  enqueueTest(owner: string) {
    return this.repository.enqueueTest(owner);
  }
  deliveries(
    owner: string,
    page: number,
    pageSize: number,
    filters: { templateId?: string; reminderId?: string } = {},
  ) {
    return this.repository.deliveries(owner, page, pageSize, filters);
  }
  start(): void {
    if (this.timer || this.stopped) return;
    this.repository.recover();
    this.reminders?.refreshCalendarSchedules();
    this.reminders?.calendar.start(
      () => this.reminders!.hasCalendarReminders(),
      () => this.reminders!.refreshCalendarSchedules(),
    );
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        console.error('通知队列处理失败，将在下次启动恢复');
      });
    }, 1000);
    this.timer.unref();
    void this.tick().catch(() => {
      console.error('通知队列处理失败，将在下次启动恢复');
    });
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.dispatch().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private async dispatch(): Promise<void> {
    this.reminders?.dispatchDue();
    const job = this.repository.claim();
    if (!job) return;
    this.controller = new AbortController();
    let code: number | null = null;
    let failure: string | undefined;
    let retryable = false;
    try {
      const result =
        job.options?.channel === 'inapp' ? 204 : await this.send(job, this.controller.signal);
      if (typeof result === 'number') code = result;
      else {
        code = result.httpStatus;
        failure = result.error;
        retryable = !!result.retryable;
      }
    } catch {
      /* Store a fixed safe error, never raw transport errors. */
    } finally {
      this.controller = undefined;
    }
    this.repository.finish(
      job,
      code,
      retryable || (!failure && (code === null || code === 408 || code === 429 || code >= 500)),
      Date.now(),
      failure,
    );
  }
  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.reminders?.calendar.close();
    await this.active;
  }
}
