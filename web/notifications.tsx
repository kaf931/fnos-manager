import { FeatureEntryCard } from './ui/feature-entry-card.js';
import { RemindersPanel } from './reminders.js';
import React, { useEffect, useRef, useState } from 'react';
import {
  NOTIFICATION_CHANNEL_LABELS,
  type NotificationTemplate,
  type NotificationTemplateSummary,
} from '../backend/domain/notifications.js';
import { type ApiClient, type Toast, errorMessage } from './contracts/shared.js';
import { AppIcon } from './ui/icon-markup.js';
import { NativeSelect } from './native-select.js';
import { ConnectionCards } from './terminal-connections.js';
import { SwitchControl } from './ui/switch-control.js';
import { EmptyState } from './empty-state.js';
import { PullRefresh } from './pull-refresh.js';
import { confirmAction } from './confirmation.js';
import { NotificationTemplateEditor } from './notification-template-editor.js';
function NotificationTemplatesPanel({
  api,
  toast,
  active,
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
}) {
  const [rows, setRows] = useState<NotificationTemplateSummary[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(new Set<string>()),
    [editor, setEditor] = useState<{ row: NotificationTemplate | null } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const alive = useRef(true),
    generation = useRef(0),
    locks = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++generation.current;
    };
  }, []);
  useEffect(() => {
    if (active) void load();
    else {
      ++generation.current;
      setLoading(false);
      setEditor(null);
    }
  }, [active, api]);
  async function load() {
    if (!activeRef.current) return;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const values = await api<NotificationTemplateSummary[]>('/notifications/templates');
      if (alive.current && activeRef.current && ticket === generation.current) {
        setRows(values);
        setError('');
      }
    } catch (e) {
      if (alive.current && activeRef.current && ticket === generation.current)
        setError(errorMessage(e));
    } finally {
      if (alive.current && activeRef.current && ticket === generation.current) setLoading(false);
    }
  }
  async function act(action: string, row: NotificationTemplateSummary) {
    if (locks.current.has(row.id)) return;
    locks.current.add(row.id);
    setBusy(new Set(locks.current));
    try {
      if (action === 'edit') {
        const value = await api<NotificationTemplate>('/notifications/templates/' + row.id);
        if (alive.current && activeRef.current) setEditor({ row: value });
        return;
      }
      if (action === 'delete') {
        if (
          !(await confirmAction({
            title: '删除通知模板',
            text: `删除“${row.name}”？历史投递记录将保留。`,
            danger: true,
            accept: '删除',
          }))
        )
          return;
        await api('/notifications/templates/' + row.id, 'DELETE');
      } else if (action === 'toggle')
        await api('/notifications/templates/' + row.id + '/enabled', 'PATCH', {
          enabled: !row.enabled,
        });
      else {
        await api('/notifications/templates/' + row.id + '/test', 'POST', {});
        if (alive.current) toast('测试已提交，可在应用清理查看投递记录');
        return;
      }
      if (alive.current && activeRef.current) await load();
    } catch (e) {
      if (alive.current) toast(errorMessage(e));
    } finally {
      locks.current.delete(row.id);
      if (alive.current) setBusy(new Set(locks.current));
    }
  }
  const shown = rows.filter(
    (row) =>
      (filter === 'all' || row.enabled === (filter === 'enabled')) &&
      (row.name + ' ' + NOTIFICATION_CHANNEL_LABELS[row.channel])
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const filters = [
    { value: 'all', label: '全部' },
    { value: 'enabled', label: '已启用' },
    { value: 'disabled', label: '已停用' },
  ];
  return (
    <div className="tool-page" hidden={!active} aria-label="通知模板">
      <PullRefresh onRefresh={load}>
        <div className="terminal-list-view">
          <header className="toolbar task-toolbar">
            <div className="task-toolbar-filters">
              <div className="search">
                <AppIcon name="search" />
                <input
                  type="search"
                  aria-label="搜索通知模板"
                  placeholder="搜索名称或渠道"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="task-status-field">
                <span id="notification-filter-label">状态</span>
                <div className="toolbar-select">
                  <div className="desktop-toolbar-filter">
                    <NativeSelect
                      aria-labelledby="notification-filter-label"
                      value={filter}
                      optionList={filters}
                      onChange={setFilter}
                    />
                  </div>
                  <div
                    className="mobile-toolbar-filter"
                    data-scroll-inset
                    role="group"
                    aria-labelledby="notification-filter-label"
                  >
                    {filters.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={filter === item.value}
                        onClick={() => setFilter(item.value)}
                      >
                        {item.label}
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
                aria-label="新增模板"
                title="新增模板"
                onClick={() => setEditor({ row: null })}
              >
                <AppIcon name="plus" />
                <span className="toolbar-action-label">新增模板</span>
              </button>
              <button
                type="button"
                className="icon-button toolbar-refresh"
                aria-label="刷新"
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
                description: (row) => NOTIFICATION_CHANNEL_LABELS[row.channel],
                tag: (row) => (row.condition === 'all' ? '全部执行结果' : '仅异常结果'),
                metaControl: (row) => (
                  <SwitchControl
                    checked={row.enabled}
                    loading={busy.has(row.id)}
                    disabled={busy.has(row.id)}
                    aria-label={'启用 ' + row.name}
                    onChange={() => void act('toggle', row)}
                  />
                ),
                icon: <AppIcon name="bell" />,
                actionLabel: '测试通知',
                busyLabel: '处理中…',
                editLabel: '编辑模板',
                deleteLabel: '删除模板',
              }}
            />
          </div>
          {!loading && !error && !shown.length && (
            <EmptyState
              subject="通知模板"
              total={rows.length}
              title="创建通知模板"
              description="通过 Webhook 或邮箱接收任务与扫描结果。"
              icon="bell"
              onAdd={() => setEditor({ row: null })}
            />
          )}
        </div>
      </PullRefresh>
      {active && editor && (
        <NotificationTemplateEditor
          key={editor.row?.id || 'new'}
          initial={editor.row}
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

export function NotificationSettingsPage({
  api,
  toast,
  active = true,
}: {
  api: ApiClient;
  toast: Toast;
  active?: boolean;
}) {
  const [view, setView] = useState<'templates' | 'reminders' | null>(null);
  return (
    <section id="notifications-page" className="tool-page" hidden={!active} aria-label="通知中心">
      <h1 className="sr-only">通知中心</h1>
      <div
        id="notification-entry"
        className="storage-entry"
        data-scroll-inset
        hidden={view !== null}
      >
        <div className="storage-entry-cards">
          <FeatureEntryCard
            title="提醒事项"
            description="记事、待办与定时提醒"
            icon={<AppIcon name="clock" />}
          >
            <div className="storage-entry-buttons">
              <button
                type="button"
                className="primary"
                aria-label="打开提醒事项"
                onClick={() => setView('reminders')}
              >
                打开
              </button>
            </div>
          </FeatureEntryCard>
          <FeatureEntryCard
            title="通知模板"
            description="管理消息渠道与发送内容"
            icon={<AppIcon name="bell" />}
          >
            <div className="storage-entry-buttons">
              <button
                type="button"
                className="primary"
                aria-label="打开通知模板"
                onClick={() => setView('templates')}
              >
                打开
              </button>
            </div>
          </FeatureEntryCard>
        </div>
      </div>
      <header className="toolbar storage-workspace-toolbar task-toolbar" hidden={view === null}>
        <button type="button" aria-label="返回通知中心" onClick={() => setView(null)}>
          <AppIcon name="back" />
          返回通知中心
        </button>
      </header>
      <NotificationTemplatesPanel api={api} toast={toast} active={active && view === 'templates'} />
      <RemindersPanel api={api} toast={toast} active={active && view === 'reminders'} />
    </section>
  );
}
