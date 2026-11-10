import React, { useRef, useState } from 'react';
import type { Reminder, ReminderInput } from '../backend/domain/reminders.js';
import { REMINDER_REPEAT_LABELS, REMINDER_REPEATS } from '../backend/domain/reminders.js';
import type { NotificationTemplateSummary } from '../backend/domain/notifications.js';
import { NOTIFICATION_CHANNEL_LABELS } from '../backend/domain/notifications.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import { NativeSelect } from './native-select.js';
import { ReactDialog } from './ui/react-dialog.js';
export function ReminderEditor({
  initial,
  templates,
  api,
  toast,
  onClose,
  onSaved,
}: {
  initial: Reminder | null;
  templates: NotificationTemplateSummary[];
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<ReminderInput>({
    name: initial?.name || '',
    content: initial?.content || '',
    dueAt: initial?.dueAt || null,
    repeat: initial?.repeat || 'none',
    templateIds: initial?.templateIds || [],
    enabled: initial?.enabled || false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const patch = (v: Partial<ReminderInput>) => setValue((old) => ({ ...old, ...v }));
  const available = templates.filter((template) => template.enabled && template.ready);
  const local = value.dueAt
    ? new Date(Date.parse(value.dueAt) + 8 * 3600000).toISOString().slice(0, 16)
    : '';
  async function save() {
    if (lock.current) return;
    if (!value.dueAt) {
      setError('请先设置提醒时间');
      return;
    }
    if (!available.some((template) => value.templateIds.includes(template.id))) {
      setError('请至少选择一个已启用且配置完整的通知模板');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api(
        '/notifications/reminders' + (initial ? '/' + initial.id : ''),
        initial ? 'PUT' : 'POST',
        value,
      );
      toast('提醒事项已保存');
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
      title={initial ? '编辑提醒事项' : '新增提醒事项'}
      busy={busy}
      onClose={onClose}
      size="medium"
      footer={
        <>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form="reminder-form"
            className="primary"
            disabled={busy || !available.length}
          >
            {busy ? '保存中…' : '保存事项'}
          </button>
        </>
      }
    >
      <form
        id="reminder-form"
        className="task-form-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <label htmlFor="reminder-name">事项名称</label>
        <input
          id="reminder-name"
          required
          maxLength={80}
          autoComplete="off"
          value={value.name}
          disabled={busy}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <label htmlFor="reminder-content">记事内容</label>
        <textarea
          id="reminder-content"
          maxLength={8000}
          rows={4}
          value={value.content}
          disabled={busy}
          onChange={(e) => patch({ content: e.target.value })}
        />
        <div className="form-grid">
          <label>
            提醒时间（北京时间）
            <input
              type="datetime-local"
              required
              value={local}
              disabled={busy}
              onChange={(e) => {
                const time = e.target.value;
                const at = time ? new Date(time + ':00+08:00') : null;
                if (at && !Number.isFinite(+at)) return;
                patch({
                  dueAt: at?.toISOString() || null,
                  ...(!at ? { repeat: 'none' as const, enabled: false } : {}),
                });
              }}
            />
          </label>
          <label id="reminder-repeat-label">
            重复
            <div className="task-form-control">
              <NativeSelect
                aria-labelledby="reminder-repeat-label"
                disabled={busy || !value.dueAt}
                value={value.repeat}
                optionList={REMINDER_REPEATS.map((key) => ({
                  value: key,
                  label: REMINDER_REPEAT_LABELS[key],
                }))}
                onChange={(key) => {
                  if (REMINDER_REPEATS.includes(key as ReminderInput['repeat']))
                    patch({ repeat: key as ReminderInput['repeat'] });
                }}
              />
            </div>
          </label>
        </div>
        <label id="reminder-template-label">通知模板</label>
        {available.length ? (
          <div className="form-check-row" role="group" aria-labelledby="reminder-template-label">
            {available.map((template) => (
              <label className="checkbox-label" key={template.id}>
                <input
                  type="checkbox"
                  checked={value.templateIds.includes(template.id)}
                  disabled={busy}
                  onChange={(e) =>
                    patch({
                      templateIds: e.target.checked
                        ? [...value.templateIds, template.id]
                        : value.templateIds.filter((id) => id !== template.id),
                    })
                  }
                />
                {template.name} · {NOTIFICATION_CHANNEL_LABELS[template.channel] || '已移除渠道'}
                {template.enabled ? '' : '（已停用）'}
              </label>
            ))}
          </div>
        ) : (
          <p className="help">请先配置并启用一个通知模板。</p>
        )}
        <div className="form-check-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={value.enabled}
              disabled={busy || initial?.status === 'completed'}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            启用提醒
          </label>
        </div>
        <p className="help">完成事项后停止通知。</p>
      </form>
    </ReactDialog>
  );
}
