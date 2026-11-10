import { SortableCards, moveCard } from './ui/sortable-cards.js';
import { NotificationDeliveryDialog } from './notification-delivery-dialog.js';
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
  renderReminders,
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
  onChanged: () => void;
  renderReminders: (
    actions: React.ReactNode,
    content: React.ReactNode,
    refreshTemplates: () => Promise<void>,
    configureTemplates: () => void,
    templateDialogOpen: boolean,
  ) => React.ReactNode;
}) {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:620px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width:620px)');
    const sync = () => setMobile(media.matches);
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  const [order, setOrder] = useState<string[]>([]),
    [sorting, setSorting] = useState(false);
  const sortLock = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [recordsTemplate, setRecordsTemplate] = useState<string | null>(null);
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
  const editorRequest = useRef(0);
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
      ++editorRequest.current;
    };
  }, []);
  useEffect(() => {
    if (active) void load();
    else {
      ++generation.current;
      ++editorRequest.current;
      setLoading(false);
      setEditor(null);
      setAllOpen(false);
      setRecordsTemplate(null);
    }
  }, [active, api]);
  async function load() {
    if (!activeRef.current) return;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const [values, position] = await Promise.all([
        api<NotificationTemplateSummary[]>('/notifications/templates'),
        api<{ keys: string[] }>('/notifications/template-order'),
      ]);
      if (alive.current && activeRef.current && ticket === generation.current) {
        setRows(values);
        setOrder(Array.isArray(position?.keys) ? position.keys : []);
        setLoaded(true);
        setError('');
      }
    } catch (e) {
      if (alive.current && activeRef.current && ticket === generation.current)
        setError(errorMessage(e));
    } finally {
      if (alive.current && activeRef.current && ticket === generation.current) setLoading(false);
    }
  }
  function showRecords(id: string) {
    ++editorRequest.current;
    setEditor(null);
    setRecordsTemplate(id);
  }
  async function act(action: string, row: NotificationTemplateSummary) {
    if (locks.current.has(row.id)) return;
    locks.current.add(row.id);
    setBusy(new Set(locks.current));
    try {
      if (action === 'records') {
        showRecords(row.id);
        return;
      }
      if (action === 'edit') {
        const request = ++editorRequest.current;
        const value = await api<NotificationTemplate>('/notifications/templates/' + row.id);
        if (alive.current && activeRef.current && request === editorRequest.current)
          setEditor({ row: value });
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
        if (alive.current) {
          toast('测试已提交');
          if (activeRef.current) showRecords(row.id);
        }
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
  const entryKey = (entry: (typeof entries)[number]) =>
    entry.row ? 'template:' + entry.row.id : 'channel:' + entry.channel;
  const rank = (entry: (typeof entries)[number]) => {
    const own = order.indexOf(entryKey(entry)),
      fallback = order.indexOf('channel:' + entry.channel);
    return own >= 0 ? own : fallback >= 0 ? fallback : Infinity;
  };
  entries.sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) - rank(b)));
  async function reorder(from: string, to: string) {
    if (sortLock.current || !activeRef.current) return;
    const previous = order;
    const keys = moveCard(entries.map(entryKey), from, to);
    sortLock.current = true;
    setSorting(true);
    setOrder(keys);
    const ticket = ++generation.current;
    setLoading(false);
    try {
      const result = await api<{ keys: string[] }>('/notifications/template-order', 'PUT', {
        keys,
      });
      if (alive.current && activeRef.current && generation.current === ticket)
        setOrder(result.keys);
    } catch (e) {
      if (alive.current && activeRef.current && generation.current === ticket) {
        setOrder(previous);
        toast(errorMessage(e));
      }
    } finally {
      sortLock.current = false;
      if (alive.current) setSorting(false);
    }
  }
  const renderCard = ({ channel, row }: (typeof entries)[number]) =>
    row ? (
      <CompactCard
        key={row.id}
        title={row.name}
        description={NOTIFICATION_CHANNEL_LABELS[row.channel] || '已移除渠道'}
        icon={<AppIcon name="bell" />}
        disabled={busy.has(row.id) || sorting}
        onOpen={() => void act('edit', row)}
        control={
          <SwitchControl
            checked={row.enabled}
            loading={busy.has(row.id)}
            disabled={sorting || busy.has(row.id) || !NOTIFICATION_CHANNELS.includes(row.channel)}
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
                  disabled={
                    sorting || busy.has(row.id) || !NOTIFICATION_CHANNELS.includes(row.channel)
                  }
                  onClick={() => void act('test', row)}
                >
                  测试通知
                </Dropdown.Item>
                <Dropdown.Item
                  disabled={busy.has(row.id) || sorting}
                  onClick={() => void act('edit', row)}
                >
                  编辑模板
                </Dropdown.Item>
                <Dropdown.Item onClick={() => void act('records', row)}>投递记录</Dropdown.Item>
                <Dropdown.Item
                  type="danger"
                  disabled={busy.has(row.id) || sorting}
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
              disabled={busy.has(row.id) || sorting}
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
        disabled={sorting || (!loaded && loading) || !!error}
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
  const actions = (
    <>
      {mobile && <NotificationInbox api={api} toast={toast} active={active} />}
      <button type="button" aria-label="全部模板" title="全部模板" onClick={() => setAllOpen(true)}>
        <AppIcon name="grid" />
        <span className="toolbar-action-label">全部模板</span>
      </button>
    </>
  );
  return (
    <>
      {renderReminders(
        actions,
        <>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <section
            className="compact-card-section desktop-only"
            hidden={!active}
            aria-label="通知模板"
          >
            <h2 className="section-label workspace-section-title">通知模板</h2>
            <CompactCardStrip label="通知模板" desktopOnly>
              {entries.map(renderCard)}
            </CompactCardStrip>
          </section>
          <h2 className="section-label workspace-section-title desktop-only">提醒事项</h2>
        </>,
        load,
        () => setAllOpen(true),
        allOpen || !!editor || !!recordsTemplate,
      )}
      {active && recordsTemplate && (
        <NotificationDeliveryDialog
          api={api}
          toast={toast}
          templateId={recordsTemplate}
          onClose={() => setRecordsTemplate(null)}
        />
      )}
      {active && allOpen && !editor && !recordsTemplate && (
        <ReactDialog
          open
          title="全部模板"
          size="large"
          onClose={() => {
            ++editorRequest.current;
            setAllOpen(false);
          }}
        >
          <div ref={overview} className="task-form-body">
            <SortableCards
              items={entries.map((entry) => ({
                id: entryKey(entry),
                name: entry.row?.name || NOTIFICATION_CHANNEL_LABELS[entry.channel],
                content: renderCard(entry),
              }))}
              disabled={sorting || loading || !loaded}
              onMove={(from, to) => void reorder(from, to)}
            />
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
          onClose={() => {
            ++editorRequest.current;
            setEditor(null);
          }}
          onSaved={() => {
            onChanged();
            setEditor(null);
            void load();
          }}
        />
      )}
    </>
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
        renderReminders={(
          actions,
          content,
          refreshTemplates,
          configureTemplates,
          templateDialogOpen,
        ) => (
          <>
            <RemindersPanel
              api={api}
              toast={toast}
              active={active}
              templateRevision={templateRevision}
              actions={actions}
              headerContent={content}
              onRefreshTemplates={refreshTemplates}
              onConfigureTemplates={configureTemplates}
              templateDialogOpen={templateDialogOpen}
            />
          </>
        )}
      />
    </section>
  );
}
