import { ReminderBatch } from './reminder-batch.js';
import { NotificationDeliveryDialog } from './notification-delivery-dialog.js';
import React, { useEffect, useRef, useState } from 'react';
import type { Reminder } from '../backend/domain/reminders.js';
import { REMINDER_REPEAT_LABELS } from '../backend/domain/reminders.js';
import type { NotificationTemplateSummary } from '../backend/domain/notifications.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import { AppIcon } from './ui/icon-markup.js';
import { NativeSelect } from './native-select.js';
import { ConnectionCards } from './terminal-connections.js';
import { SwitchControl } from './ui/switch-control.js';
import { PullRefresh } from './pull-refresh.js';
import { EmptyState } from './empty-state.js';
import { confirmAction } from './confirmation.js';
import { ReminderEditor } from './reminder-editor.js';
const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '';
export function RemindersPanel({
  api,
  toast,
  active,
  templateRevision = 0,
  actions,
  headerContent,
  onRefreshTemplates,
  onConfigureTemplates,
  templateDialogOpen = false,
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
  templateRevision?: number;
  actions?: React.ReactNode;
  headerContent?: React.ReactNode;
  onRefreshTemplates?: () => Promise<void>;
  onConfigureTemplates?: () => void;
  templateDialogOpen?: boolean;
}) {
  const [loaded, setLoaded] = useState(false),
    [batchOpen, setBatchOpen] = useState(false),
    [recordsReminder, setRecordsReminder] = useState<string | null>(null);
  const [rows, setRows] = useState<Reminder[]>([]),
    [templates, setTemplates] = useState<NotificationTemplateSummary[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('open'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(new Set<string>()),
    [editor, setEditor] = useState<{ row: Reminder | null } | null>(null);
  const alive = useRef(true),
    activeRef = useRef(active),
    epoch = useRef(0),
    locks = useRef(new Set<string>()),
    foregroundLoading = useRef(false);
  activeRef.current = active;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++epoch.current;
    };
  }, []);
  useEffect(() => {
    if (active) void load();
    else {
      ++epoch.current;
      setLoading(false);
      foregroundLoading.current = false;
      setEditor(null);
      setBatchOpen(false);
      setRecordsReminder(null);
    }
  }, [active, api, templateRevision]);
  useEffect(() => {
    if (!active || editor || batchOpen) return;
    const sync = () => {
      if (document.visibilityState !== 'hidden' && !locks.current.size) void load(true);
    };
    const timer = setInterval(sync, 15000);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [active, api, editor, batchOpen]);
  async function load(background = false) {
    if (!activeRef.current || (background && foregroundLoading.current)) return;
    if (!background) foregroundLoading.current = true;
    const ticket = ++epoch.current;
    if (!background) setLoading(true);
    try {
      const [values, channels] = await Promise.all([
        api<Reminder[]>('/notifications/reminders'),
        api<NotificationTemplateSummary[]>('/notifications/templates'),
      ]);
      if (alive.current && activeRef.current && ticket === epoch.current) {
        setRows(values);
        setLoaded(true);
        setTemplates(channels);
        setError('');
      }
    } catch (e) {
      if (!background && alive.current && activeRef.current && ticket === epoch.current)
        setError(errorMessage(e));
    } finally {
      if (!background && alive.current && ticket === epoch.current) {
        foregroundLoading.current = false;
        setLoading(false);
      }
    }
  }
  async function refresh() {
    await Promise.all([load(), onRefreshTemplates?.()]);
  }
  async function act(action: string, row: Reminder) {
    if (locks.current.has(row.id)) return;
    if (action === 'records') {
      setRecordsReminder(row.id);
      return;
    }
    if (action === 'edit') {
      setEditor({ row });
      return;
    }
    locks.current.add(row.id);
    setBusy(new Set(locks.current));
    try {
      if (action === 'delete') {
        if (
          !(await confirmAction({
            title: '删除提醒事项',
            text: `删除“${row.name}”及记事内容？历史投递记录将保留。`,
            accept: '删除',
            danger: true,
          }))
        )
          return;
        await api('/notifications/reminders/' + row.id, 'DELETE');
      } else if (action === 'toggle')
        await api('/notifications/reminders/' + row.id + '/enabled', 'PATCH', {
          enabled: !row.enabled,
        });
      else
        await api('/notifications/reminders/' + row.id + '/completed', 'PATCH', {
          completed: row.status !== 'completed',
        });
      if (alive.current && activeRef.current) await load();
    } catch (e) {
      if (alive.current && activeRef.current) toast(errorMessage(e));
    } finally {
      locks.current.delete(row.id);
      if (alive.current) setBusy(new Set(locks.current));
    }
  }
  const filters = [
    { value: 'open', label: '待办' },
    { value: 'completed', label: '已完成' },
    { value: 'all', label: '全部' },
  ];
  const shown = rows.filter(
    (row) =>
      (filter === 'all' || row.status === filter) &&
      (row.name + ' ' + row.content).toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="tool-page" hidden={!active} aria-label="提醒事项">
      <PullRefresh onRefresh={refresh}>
        <div className="terminal-list-view">
          <header className="toolbar task-toolbar">
            <div className="task-toolbar-filters">
              <div className="search">
                <AppIcon name="search" />
                <input
                  type="search"
                  aria-label="搜索提醒事项"
                  placeholder="搜索名称或内容"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="task-status-field">
                <span id="reminder-status-label">状态</span>
                <div className="toolbar-select">
                  <div className="desktop-toolbar-filter">
                    <NativeSelect
                      aria-labelledby="reminder-status-label"
                      value={filter}
                      optionList={filters}
                      onChange={setFilter}
                    />
                  </div>
                  <div
                    className="mobile-toolbar-filter"
                    data-scroll-inset
                    role="group"
                    aria-labelledby="reminder-status-label"
                  >
                    {filters.map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        aria-pressed={filter === v.value}
                        onClick={() => setFilter(v.value)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="toolbar-actions">
              {actions}
              <button
                type="button"
                className="toolbar-manage"
                aria-label="批量管理提醒"
                title="批量管理"
                onClick={() => setBatchOpen(true)}
              >
                <AppIcon name="grid" />
                <span className="toolbar-action-label">批量管理</span>
              </button>
              <button
                type="button"
                className="primary"
                aria-label="新增事项"
                title="新增事项"
                onClick={() => setEditor({ row: null })}
              >
                <AppIcon name="plus" />
                <span className="toolbar-action-label">新增事项</span>
              </button>
              <button
                type="button"
                className="icon-button toolbar-refresh"
                aria-label={onRefreshTemplates ? '刷新通知中心' : '刷新提醒事项'}
                title="刷新"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <AppIcon name="refresh" />
                <span>刷新</span>
              </button>
            </div>
          </header>
          {headerContent}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="cards connection-cards" data-scroll-inset hidden={!shown.length}>
            <ConnectionCards
              rows={shown.map((row) => ({ ...row, busy: busy.has(row.id) }))}
              onAction={(action, row) => void act(action, row)}
              options={{
                icon: <AppIcon name="clock" />,
                description: (row) =>
                  row.error ||
                  (row.nextAt
                    ? time(row.nextAt)
                    : row.status === 'completed'
                      ? '已完成'
                      : row.dueAt
                        ? time(row.dueAt)
                        : '记事') + (row.content ? ' · ' + row.content.split('\n')[0] : ''),
                tag: (row) =>
                  (row.status === 'completed'
                    ? '已完成'
                    : row.error
                      ? '模板不可用'
                      : row.enabled
                        ? '待提醒'
                        : row.repeat === 'none' && row.lastFiredAt
                          ? '已触发'
                          : '已暂停') +
                  ' · ' +
                  REMINDER_REPEAT_LABELS[row.repeat],
                metaControl: (row) => (
                  <SwitchControl
                    checked={row.enabled}
                    loading={busy.has(row.id)}
                    disabled={busy.has(row.id) || row.status === 'completed'}
                    aria-label={'提醒 ' + row.name}
                    title={
                      row.status === 'completed'
                        ? '请先重新打开事项'
                        : row.enabled
                          ? '暂停提醒'
                          : '启用提醒'
                    }
                    onChange={() => void act('toggle', row)}
                  />
                ),
                actionLabel: (row) => (row.status === 'completed' ? '重新打开' : '标记完成'),
                busyLabel: '处理中…',
                editLabel: '编辑事项',
                deleteLabel: '删除事项',
                extraActions: () => [['records', '投递记录', 'clock']],
              }}
            />
          </div>
          {(!loading || loaded) && !error && !shown.length && (
            <EmptyState
              subject="提醒事项"
              total={rows.length}
              title="记下需要处理的事情"
              description="填写事项，选择通知模板按时提醒。"
              icon="clock"
              onAdd={() => setEditor({ row: null })}
            />
          )}
        </div>
      </PullRefresh>
      {active && batchOpen && (
        <ReminderBatch
          rows={shown}
          api={api}
          toast={toast}
          onClose={() => setBatchOpen(false)}
          onSaved={() => {
            setBatchOpen(false);
            void load();
          }}
        />
      )}
      {active && recordsReminder && (
        <NotificationDeliveryDialog
          api={api}
          toast={toast}
          reminderId={recordsReminder}
          onClose={() => setRecordsReminder(null)}
        />
      )}
      {active && editor && (
        <ReminderEditor
          initial={editor.row}
          open={!templateDialogOpen}
          onConfigureTemplates={onConfigureTemplates}
          templates={templates}
          api={api}
          toast={toast}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
