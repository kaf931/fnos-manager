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
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
}) {
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
    locks = useRef(new Set<string>());
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
      setEditor(null);
    }
  }, [active, api]);
  async function load() {
    if (!activeRef.current) return;
    const ticket = ++epoch.current;
    setLoading(true);
    try {
      const [values, channels] = await Promise.all([
        api<Reminder[]>('/notifications/reminders'),
        api<NotificationTemplateSummary[]>('/notifications/templates'),
      ]);
      if (alive.current && activeRef.current && ticket === epoch.current) {
        setRows(values);
        setTemplates(channels);
        setError('');
      }
    } catch (e) {
      if (alive.current && activeRef.current && ticket === epoch.current) setError(errorMessage(e));
    } finally {
      if (alive.current && ticket === epoch.current) setLoading(false);
    }
  }
  async function act(action: string, row: Reminder) {
    if (locks.current.has(row.id)) return;
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
      else if (action === 'snooze')
        await api('/notifications/reminders/' + row.id + '/snooze', 'POST', {});
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
      <PullRefresh onRefresh={load}>
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
                aria-label="刷新提醒事项"
                title="刷新"
                disabled={loading}
                onClick={() => void load()}
              >
                <AppIcon name="refresh" />
                <span>刷新</span>
              </button>
            </div>
          </header>
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
                  row.repeat === 'none' && !row.dueAt ? '记事' : REMINDER_REPEAT_LABELS[row.repeat],
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
                extraActions: (row) =>
                  row.status === 'completed' ? [] : [['snooze', '延后15分钟', 'refresh']],
              }}
            />
          </div>
          {!loading && !error && !shown.length && (
            <EmptyState
              subject="提醒事项"
              total={rows.length}
              title="记下需要处理的事情"
              description="保存记事，或选择通知模板按时提醒。"
              icon="clock"
              onAdd={() => setEditor({ row: null })}
            />
          )}
        </div>
      </PullRefresh>
      {active && editor && (
        <ReminderEditor
          initial={editor.row}
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
