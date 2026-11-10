import { ReactDialog } from './ui/react-dialog.js';
import { NotificationInbox } from './notification-inbox.js';
import { CompactCard, CompactCardStrip } from './ui/compact-card-strip.js';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';
import { MobileMoreButton } from './mobile-more-button.js';
import { RemindersPanel } from './reminders.js';
import React, { useEffect, useRef, useState } from 'react';
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationTemplate,
  type NotificationTemplateSummary,
} from '../backend/domain/notifications.js';
import { type ApiClient, type Toast, errorMessage } from './contracts/shared.js';
import { AppIcon } from './ui/icon-markup.js';
import { SwitchControl } from './ui/switch-control.js';
import { confirmAction } from './confirmation.js';
import { NotificationTemplateEditor } from './notification-template-editor.js';
function NotificationTemplatesPanel({
  api,
  toast,
  active,
  onChanged,
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<NotificationTemplateSummary[]>([]),
    [allOpen, setAllOpen] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(new Set<string>()),
    [editor, setEditor] = useState<{
      row: NotificationTemplate | null;
      channel?: NotificationChannel;
    } | null>(null);
  const overview = useRef<HTMLDivElement>(null);
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
      setAllOpen(false);
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
      if (alive.current && activeRef.current) {
        onChanged();
        await load();
      }
    } catch (e) {
      if (alive.current) toast(errorMessage(e));
    } finally {
      locks.current.delete(row.id);
      if (alive.current) setBusy(new Set(locks.current));
    }
  }
  const entries: { channel: NotificationChannel; row: NotificationTemplateSummary | null }[] = [];
  for (const channel of NOTIFICATION_CHANNELS) {
    const configured = rows.filter((row) => row.channel === channel);
    if (configured.length) entries.push(...configured.map((row) => ({ channel, row })));
    else entries.push({ channel, row: null });
  }
  // Retain saved configurations whose provider is no longer supported so they can be edited or removed.
  entries.push(
    ...rows
      .filter((row) => !NOTIFICATION_CHANNELS.includes(row.channel))
      .map((row) => ({ channel: row.channel, row })),
  );
  const renderCard = ({ channel, row }: (typeof entries)[number]) =>
    row ? (
      <CompactCard
        key={row.id}
        title={row.name}
        description={NOTIFICATION_CHANNEL_LABELS[row.channel] || '已移除渠道'}
        icon={<AppIcon name="bell" />}
        disabled={busy.has(row.id)}
        onOpen={() => void act('edit', row)}
        control={
          <SwitchControl
            checked={row.enabled}
            loading={busy.has(row.id)}
            disabled={busy.has(row.id) || !NOTIFICATION_CHANNELS.includes(row.channel)}
            aria-label={'启用 ' + row.name}
            onChange={() => void act('toggle', row)}
          />
        }
        actions={
          <Dropdown
            trigger="click"
            position="bottomRight"
            getPopupContainer={() =>
              (allOpen && !editor ? overview.current?.closest('dialog') : null) || document.body
            }
            render={
              <Dropdown.Menu>
                <Dropdown.Item
                  disabled={busy.has(row.id) || !NOTIFICATION_CHANNELS.includes(row.channel)}
                  onClick={() => void act('test', row)}
                >
                  测试通知
                </Dropdown.Item>
                <Dropdown.Item disabled={busy.has(row.id)} onClick={() => void act('edit', row)}>
                  编辑模板
                </Dropdown.Item>
                <Dropdown.Item
                  type="danger"
                  disabled={busy.has(row.id)}
                  onClick={() => void act('delete', row)}
                >
                  删除模板
                </Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <MobileMoreButton
              aria-label={row.name + '的更多操作'}
              title="更多操作"
              disabled={busy.has(row.id)}
            />
          </Dropdown>
        }
      />
    ) : (
      <CompactCard
        key={channel}
        title={NOTIFICATION_CHANNEL_LABELS[channel]}
        description="未配置"
        icon={<AppIcon name="bell" />}
        openLabel={'配置 ' + NOTIFICATION_CHANNEL_LABELS[channel]}
        disabled={loading || !!error}
        onOpen={() => setEditor({ row: null, channel })}
        control={
          <SwitchControl
            checked={false}
            disabled
            aria-label={'启用 ' + NOTIFICATION_CHANNEL_LABELS[channel]}
          />
        }
      />
    );
  return (
    <section className="compact-card-section" hidden={!active} aria-label="通知模板">
      <header className="toolbar task-toolbar">
        <h2 className="workspace-section-title">通知模板</h2>
        <div className="toolbar-actions">
          <NotificationInbox api={api} toast={toast} active={active} />
          <button
            type="button"
            aria-label="全部模板"
            title="全部模板"
            onClick={() => setAllOpen(true)}
          >
            <AppIcon name="grid" />
            <span className="toolbar-action-label">全部</span>
          </button>
          <button
            type="button"
            className="icon-button toolbar-refresh"
            aria-label="刷新通知模板"
            title="刷新通知模板"
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
      <CompactCardStrip label="通知模板">{entries.map(renderCard)}</CompactCardStrip>
      {active && allOpen && !editor && (
        <ReactDialog open title="全部模板" size="large" onClose={() => setAllOpen(false)}>
          <div ref={overview} className="task-form-body">
            <div className="cards">{entries.map(renderCard)}</div>
          </div>
        </ReactDialog>
      )}
      {active && editor && (
        <NotificationTemplateEditor
          key={editor.row?.id || editor.channel || 'new'}
          initial={editor.row}
          initialChannel={editor.channel}
          api={api}
          toast={toast}
          onClose={() => setEditor(null)}
          onSaved={() => {
            onChanged();
            setEditor(null);
            void load();
          }}
        />
      )}
    </section>
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
  const [templateRevision, setTemplateRevision] = useState(0);
  return (
    <section id="notifications-page" className="tool-page" hidden={!active} aria-label="通知中心">
      <h1 className="sr-only">通知中心</h1>
      <NotificationTemplatesPanel
        api={api}
        toast={toast}
        active={active}
        onChanged={() => setTemplateRevision((v) => v + 1)}
      />
      <h2 className="section-label workspace-section-title">提醒事项</h2>
      <RemindersPanel api={api} toast={toast} active={active} templateRevision={templateRevision} />
    </section>
  );
}
