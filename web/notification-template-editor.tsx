import React, { useRef, useState } from 'react';
import {
  DEFAULT_NOTIFICATION_OPTIONS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_TOKEN_LABELS,
  type NotificationChannel,
  type NotificationTemplate,
  type NotificationTemplateInput,
} from '../backend/domain/notifications.js';
import { NativeSelect } from './native-select.js';
import { PasswordField } from './password-field.js';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
export function NotificationTemplateEditor({
  initial,
  initialChannel,
  api,
  toast,
  onClose,
  onSaved,
}: {
  initial: NotificationTemplate | null;
  initialChannel?: NotificationChannel;
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onSaved: () => void;
}) {
  const unavailable = !!initial && !NOTIFICATION_CHANNELS.includes(initial.channel);
  const source: Partial<NotificationTemplate> = unavailable
    ? { name: initial.name }
    : initial || {};
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...editable } = source;
  const [settings, setSettings] = useState<
    NotificationTemplateInput & typeof DEFAULT_NOTIFICATION_OPTIONS
  >({
    ...DEFAULT_NOTIFICATION_OPTIONS,
    enabled: false,
    url: initialChannel === 'bark' ? 'https://api.day.app/push' : '',
    token: '',
    condition: 'errors',
    scanFailures: true,
    channel: initialChannel || 'webhook',
    name: initialChannel ? NOTIFICATION_CHANNEL_LABELS[initialChannel] : '',
    ...editable,
  });
  const [headersText, setHeadersText] = useState(JSON.stringify(settings.headers || {}, null, 2));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  function patch(value: Partial<NotificationTemplateInput>) {
    setSettings((old) => ({ ...old, ...value }));
  }
  async function save() {
    if (lock.current || unavailable) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      let headers: Record<string, string>;
      try {
        headers = JSON.parse(headersText);
      } catch {
        throw Error('自定义请求头必须是有效 JSON');
      }
      await api(
        '/notifications/templates' + (initial ? '/' + initial.id : ''),
        initial ? 'PUT' : 'POST',
        { ...settings, headers },
      );
      toast('通知模板已保存');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ReactDialog
      open
      title={initial ? '编辑通知模板' : '新增通知模板'}
      onClose={onClose}
      busy={busy}
      size="medium"
      footer={
        <>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form="notification-template-form"
            className="primary"
            disabled={busy || unavailable}
          >
            {busy ? '保存中…' : '保存模板'}
          </button>
        </>
      }
    >
      <form
        id="notification-template-form"
        className="task-form-body"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {unavailable && (
          <p className="notice">原通知渠道已移除，请从内置模板重新配置。旧模板不会转换渠道。</p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <label htmlFor="notification-name">模板名称</label>
        <input
          id="notification-name"
          autoComplete="off"
          required
          maxLength={80}
          value={settings.name}
          disabled={busy}
          onChange={(e) => patch({ name: e.target.value })}
        />
        {!['email', 'serverchan', 'inapp'].includes(settings.channel) && (
          <>
            <label htmlFor="notification-url">
              {settings.channel === 'bark' ? '推送地址' : 'Webhook 地址'}
            </label>
            <input
              id="notification-url"
              type="url"
              value={settings.url}
              maxLength={2048}
              autoComplete="off"
              name="notification-endpoint"
              placeholder="https://example.com/webhook"
              disabled={busy}
              onChange={(e) => patch({ url: e.target.value })}
            />
          </>
        )}
        {settings.channel !== 'email' && NOTIFICATION_TOKEN_LABELS[settings.channel] && (
          <>
            <label htmlFor="notification-token">
              {NOTIFICATION_TOKEN_LABELS[settings.channel]}
            </label>
            <PasswordField
              id="notification-token"
              label={NOTIFICATION_TOKEN_LABELS[settings.channel] || 'Token'}
              autoComplete="new-password"
              name="notification-credential"
              maxLength={4096}
              value={settings.token}
              disabled={busy}
              onChange={(e) => patch({ token: e.target.value })}
            />
          </>
        )}
        {settings.channel === 'serverchan' && (
          <p className="help">
            在{' '}
            <a href="https://sct.ftqq.com/r/29101" target="_blank" rel="noopener noreferrer">
              Server酱
            </a>{' '}
            获取 SendKey，支持 SCT 和 sctp。
          </p>
        )}
        {settings.channel === 'bark' && (
          <p className="help">在 iPhone 的 Bark 中获取 Device Key，可填写自建推送地址。</p>
        )}
        {settings.channel === 'inapp' && (
          <p className="help">消息保存在应用内，保留上限与投递记录一致。</p>
        )}
        {settings.channel === 'email' && (
          <>
            <div className="form-grid">
              <label>
                SMTP 主机
                <input
                  value={settings.smtpHost}
                  maxLength={253}
                  autoComplete="off"
                  name="notification-smtp-host"
                  placeholder="smtp.example.com"
                  disabled={busy}
                  onChange={(e) => patch({ smtpHost: e.target.value })}
                />
              </label>
              <label>
                端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={settings.smtpPort}
                  disabled={busy}
                  onChange={(e) => patch({ smtpPort: Number(e.target.value) })}
                />
              </label>
            </div>
            <label id="smtp-security-label">连接安全</label>
            <div className="task-form-control">
              <NativeSelect
                aria-labelledby="smtp-security-label"
                value={settings.smtpSecurity}
                disabled={busy}
                optionList={[
                  { value: 'starttls', label: 'STARTTLS（通常为 587）' },
                  { value: 'tls', label: 'TLS（通常为 465）' },
                  { value: 'none', label: '不加密' },
                ]}
                onChange={(value) => {
                  if (value === 'tls' || value === 'starttls' || value === 'none')
                    patch({
                      smtpSecurity: value,
                      smtpPort: value === 'tls' ? 465 : value === 'starttls' ? 587 : 25,
                    });
                }}
              />
            </div>
            <label htmlFor="smtp-user">登录账号</label>
            <input
              id="smtp-user"
              autoComplete="off"
              name="notification-smtp-account"
              maxLength={320}
              value={settings.smtpUser}
              disabled={busy}
              onChange={(e) => patch({ smtpUser: e.target.value })}
            />
            <label htmlFor="notification-token">授权码／密码</label>
            <PasswordField
              id="notification-token"
              label="授权码／密码"
              autoComplete="new-password"
              name="notification-credential"
              maxLength={4096}
              value={settings.token}
              disabled={busy}
              onChange={(e) => patch({ token: e.target.value })}
            />
            <div className="form-grid">
              <label>
                发件邮箱
                <input
                  type="email"
                  autoComplete="off"
                  maxLength={320}
                  value={settings.smtpFrom}
                  disabled={busy}
                  onChange={(e) => patch({ smtpFrom: e.target.value })}
                />
              </label>
              <label>
                收件邮箱
                <input
                  autoComplete="off"
                  maxLength={2048}
                  placeholder="多个邮箱用逗号分隔"
                  value={settings.smtpTo}
                  disabled={busy}
                  onChange={(e) => patch({ smtpTo: e.target.value })}
                />
              </label>
            </div>
            <label htmlFor="smtp-subject">邮件标题（可选）</label>
            <input
              id="smtp-subject"
              maxLength={200}
              value={settings.smtpSubject}
              placeholder="NAS 管家 · {{name}}"
              disabled={busy}
              onChange={(e) => patch({ smtpSubject: e.target.value })}
            />
            <label htmlFor="email-template">消息内容（可选）</label>
            <textarea
              id="email-template"
              rows={4}
              maxLength={8000}
              value={settings.template}
              placeholder="{{name}}：{{statusText}}"
              disabled={busy}
              onChange={(e) => patch({ template: e.target.value })}
            />
            <p className="help">支持任务名称、结果和完成时间等模板变量；留空使用默认内容。</p>
          </>
        )}
        {['webhook', 'dingtalk', 'feishu'].includes(settings.channel) && (
          <>
            <label htmlFor="notification-signing">签名密钥（可选）</label>
            <PasswordField
              id="notification-signing"
              label="签名密钥"
              autoComplete="new-password"
              name="notification-credential"
              maxLength={4096}
              value={settings.signingSecret}
              disabled={busy}
              onChange={(e) => patch({ signingSecret: e.target.value })}
            />
          </>
        )}
        {!['email', 'inapp'].includes(settings.channel) && (
          <details className="help-details">
            <summary>自定义消息与请求头</summary>
            <label htmlFor="notification-template">
              {settings.channel === 'webhook' ? 'JSON 消息模板（可选）' : '消息模板（可选）'}
            </label>
            <textarea
              id="notification-template"
              rows={5}
              maxLength={8000}
              value={settings.template}
              disabled={busy}
              placeholder={
                settings.channel === 'webhook'
                  ? '{"message":"{{name}}：{{statusText}}"}'
                  : '{{name}}：{{statusText}}'
              }
              onChange={(e) => patch({ template: e.target.value })}
            />
            <p className="help">
              留空使用默认消息。变量：{'{{name}}'}、{'{{statusText}}'}、{'{{status}}'}、
              {'{{eventType}}'}、{'{{eventId}}'}、{'{{taskType}}'}、{'{{startedAt}}'}、
              {'{{finishedAt}}'}、{'{{exitCode}}'}。
            </p>
            <label htmlFor="notification-headers">自定义请求头（JSON）</label>
            <textarea
              id="notification-headers"
              rows={3}
              maxLength={16384}
              value={headersText}
              disabled={busy}
              placeholder={'{"X-Api-Key":"your-key"}'}
              onChange={(e) => {
                setHeadersText(e.target.value);
              }}
            />
          </details>
        )}
        <label id="notification-condition">任务通知条件</label>
        <div className="task-form-control">
          <NativeSelect
            aria-labelledby="notification-condition"
            value={settings.condition}
            disabled={busy}
            optionList={[
              { value: 'errors', label: '仅失败、超时或中断' },
              { value: 'all', label: '全部执行结果' },
            ]}
            onChange={(value) => {
              if (value === 'errors' || value === 'all') patch({ condition: value });
            }}
          />
        </div>
        <div className="form-check-row system-settings-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.scanFailures}
              disabled={busy}
              onChange={(e) => patch({ scanFailures: e.target.checked })}
            />
            扫描失败或中断时通知
          </label>
          <label className="checkbox-label">
            <input
              id="notification-enabled"
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            启用通知
          </label>
        </div>
      </form>
    </ReactDialog>
  );
}
