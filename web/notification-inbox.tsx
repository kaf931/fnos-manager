import { useNotificationUnread, refreshNotificationUnread } from './notification-unread.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';
import type { InboxMessage } from '../backend/domain/notifications.js';
import { type ApiClient, type Toast, errorMessage } from './contracts/shared.js';
import { ReactDialog } from './ui/react-dialog.js';
import { AppIcon } from './ui/icon-markup.js';
import { MobileMoreButton } from './mobile-more-button.js';
import { NativeSelect } from './native-select.js';
import {
  RecordBatchControl,
  useRecordBatch,
  RecordSelect,
  RecordSelectAll,
} from './record-batch.js';
import { useRecordPage, RecordFooter, RecordList } from './record-list.js';
import { compactRecordDate } from './record-date.js';
export function NotificationInbox({
  api,
  toast,
  active,
  menu = false,
  openRequest = 0,
  hideTrigger = false,
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
  menu?: boolean;
  openRequest?: number;
  hideTrigger?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuSpacing, setMenuSpacing] = useState({ x: 8, y: 4 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState<InboxMessage[]>([]);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [initialMessage, setInitialMessage] = useState<InboxMessage | null>(null);
  useEffect(() => {
    if (!active || !menuOpen) return;
    let live = true;
    setPreviewLoading(true);
    setPreviewError('');
    void api<{ items: InboxMessage[] }>('/notifications/inbox?page=1&pageSize=5&filter=all')
      .then((value) => {
        if (live) setPreview(value.items);
      })
      .catch((e) => {
        if (live) setPreviewError(errorMessage(e));
      })
      .finally(() => {
        if (live) setPreviewLoading(false);
      });
    return () => {
      live = false;
    };
  }, [active, menuOpen, api]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (active && openRequest > 0) {
      setInitialMessage(null);
      setOpen(true);
    }
  }, [active, openRequest]);
  const [markingAll, setMarkingAll] = useState(false);
  const markLock = useRef(false);
  const count = useNotificationUnread(api, active);
  useEffect(() => {
    if (!active) {
      setOpen(false);
      setMenuOpen(false);
    }
  }, [active]);
  async function markAllRead() {
    if (markLock.current) return;
    markLock.current = true;
    setMarkingAll(true);
    try {
      await api('/notifications/inbox/read-all', 'POST', {});
      setPreview((old) =>
        old.map((message) => ({ ...message, readAt: message.readAt || new Date().toISOString() })),
      );
      refreshNotificationUnread(api);
      setMenuOpen(false);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      markLock.current = false;
      setMarkingAll(false);
    }
  }
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      title="应用内消息"
      className={menu ? 'icon-button activity-badge-host' : 'activity-badge-host'}
      aria-label={count ? `应用内消息，${count} 条未读` : '应用内消息'}
      onClick={() => {
        if (!menu) {
          setInitialMessage(null);
          setOpen(true);
        }
      }}
    >
      <AppIcon name="bell" />
      {!menu && <span className="toolbar-action-label">消息</span>}
      {count > 0 && (
        <span className="activity-badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
  return (
    <>
      {hideTrigger ? null : menu ? (
        <Dropdown
          trigger="click"
          position="rightBottom"
          spacing={menuSpacing}
          contentClassName="content-surface-menu"
          visible={menuOpen}
          onVisibleChange={(visible) => {
            if (visible) {
              const card = document.querySelector('.layout main')?.getBoundingClientRect();
              const trigger = triggerRef.current?.getBoundingClientRect();
              if (card && trigger)
                setMenuSpacing({ x: card.left - trigger.right, y: card.bottom - trigger.bottom });
            }
            setMenuOpen(visible);
          }}
          render={
            <Dropdown.Menu>
              {previewLoading ? (
                <Dropdown.Item disabled>正在读取消息…</Dropdown.Item>
              ) : previewError ? (
                <Dropdown.Item disabled>{previewError}</Dropdown.Item>
              ) : preview.length ? (
                preview.map((message) => (
                  <Dropdown.Item
                    key={message.id}
                    onClick={() => {
                      setMenuOpen(false);
                      setInitialMessage(message);
                      setOpen(true);
                    }}
                  >
                    <div>
                      <div title={message.name}>
                        {message.readAt ? '' : '• '}
                        {message.name}
                      </div>
                      <div className="card-url" title={message.content}>
                        {Array.from(message.content.replace(/\s+/g, ' ').trim())
                          .slice(0, 36)
                          .join('')}
                        {Array.from(message.content.trim()).length > 36 ? '…' : ''}
                      </div>
                      <div className="card-url">{compactRecordDate(message.createdAt)}</div>
                    </div>
                  </Dropdown.Item>
                ))
              ) : (
                <Dropdown.Item disabled>暂无消息</Dropdown.Item>
              )}
              <Dropdown.Item disabled={markingAll || !count} onClick={() => void markAllRead()}>
                {markingAll ? '正在标记…' : '全部已读'}
              </Dropdown.Item>
              <Dropdown.Item
                onClick={() => {
                  setMenuOpen(false);
                  setInitialMessage(null);
                  setOpen(true);
                }}
              >
                查看全部消息
              </Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          {trigger}
        </Dropdown>
      ) : (
        trigger
      )}
      {active && open && (
        <InboxDialog
          api={api}
          toast={toast}
          initialMessage={initialMessage}
          onClose={() => setOpen(false)}
          onChanged={() => refreshNotificationUnread(api)}
        />
      )}
    </>
  );
}
function InboxDialog({
  initialMessage = null,
  api,
  toast,
  onClose,
  onChanged,
}: {
  initialMessage?: InboxMessage | null;
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onChanged: () => void;
}) {
  useEffect(() => {
    if (initialMessage && !initialMessage.readAt) void read([initialMessage.id]);
  }, [initialMessage]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'),
    [menuOpen, setMenuOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<InboxMessage | null>(initialMessage),
    [, rerender] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const readQueue = useRef({ ids: new Set<string>(), all: false, running: false });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      readQueue.current.ids.clear();
      readQueue.current.all = false;
    };
  }, []);
  const control = useMemo(
    () => new RecordBatchControl(() => rerender((v) => v + 1), toast),
    [toast],
  );
  const model = useRecordPage<InboxMessage>({
    api,
    path: '/notifications/inbox',
    active: true,
    revision: 0,
    filters: '&filter=' + filter + '&q=' + encodeURIComponent(search.trim()),
  });
  const selection = useRecordBatch({
    api,
    kind: 'deliveries',
    items: model.items,
    active: true,
    scope: search.trim() + '|' + filter + '|' + model.page + '|' + model.pageSize,
    control,
    refresh: () => {
      model.refresh();
      onChanged();
    },
  });
  async function read(ids?: string[]) {
    if (!alive.current) return;
    const queue = readQueue.current;
    if (ids) ids.forEach((id) => queue.ids.add(id));
    else {
      queue.all = true;
      queue.ids.clear();
    }
    if (queue.running) return;
    queue.running = true;
    setBusy(true);
    try {
      while (alive.current && (queue.all || queue.ids.size)) {
        const batch = queue.all ? undefined : [...queue.ids].slice(0, 200);
        if (batch) batch.forEach((id) => queue.ids.delete(id));
        else {
          queue.all = false;
          queue.ids.clear();
        }
        try {
          await api(
            batch ? '/notifications/inbox/read' : '/notifications/inbox/read-all',
            'POST',
            batch ? { ids: batch } : {},
          );
          if (alive.current) {
            model.refresh();
            onChanged();
          }
        } catch (e) {
          if (alive.current) toast(errorMessage(e));
        }
      }
    } finally {
      queue.running = false;
      if (alive.current) setBusy(false);
    }
  }
  function show(row: InboxMessage) {
    setDetail(row);
    if (!row.readAt) void read([row.id]);
  }
  return (
    <ReactDialog
      open
      title={detail ? '消息详情' : '应用内消息'}
      onClose={onClose}
      size="large"
      layout="workspace"
      busy={busy || selection.busy}
    >
      <div ref={container} className="task-form-body tool-page record-content">
        {detail ? (
          <>
            <header className="toolbar task-toolbar">
              <button type="button" onClick={() => setDetail(null)}>
                <AppIcon name="back" />
                返回消息
              </button>
            </header>
            <h3>{detail.name}</h3>
            <div className="history-run-output">{detail.content}</div>
            <p className="help">{compactRecordDate(detail.createdAt)}</p>
          </>
        ) : (
          <>
            <header className="toolbar task-toolbar">
              <div className="task-toolbar-filters">
                <div className="search">
                  <AppIcon name="search" />
                  <input
                    type="search"
                    aria-label="搜索消息"
                    placeholder="搜索标题或内容"
                    maxLength={200}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="task-status-field">
                  <span id="inbox-filter-label">状态</span>
                  <div className="toolbar-select">
                    <div className="desktop-toolbar-filter">
                      <NativeSelect
                        aria-label="消息状态"
                        value={filter}
                        optionList={[
                          { value: 'all', label: '全部消息' },
                          { value: 'unread', label: '未读消息' },
                        ]}
                        onChange={setFilter}
                      />
                    </div>
                    <div
                      className="mobile-toolbar-filter"
                      role="group"
                      aria-labelledby="inbox-filter-label"
                    >
                      {[
                        { value: 'all', label: '全部' },
                        { value: 'unread', label: '未读' },
                      ].map((item) => (
                        <button
                          type="button"
                          key={item.value}
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
                  className="toolbar-manage"
                  title="批量删除"
                  aria-label="批量删除消息"
                  disabled={busy || selection.busy || !selection.selected.size}
                  onClick={() => void control.manage().catch((e) => toast(errorMessage(e)))}
                >
                  <AppIcon name="trash" />
                  <span className="toolbar-action-label">批量删除</span>
                </button>
                <button
                  type="button"
                  className="icon-button toolbar-refresh"
                  title="刷新消息"
                  aria-label="刷新消息"
                  disabled={busy || model.loading}
                  onClick={() => {
                    model.refresh();
                    onChanged();
                  }}
                >
                  <AppIcon name="refresh" />
                </button>
                <Dropdown
                  trigger="click"
                  visible={menuOpen}
                  onVisibleChange={setMenuOpen}
                  clickTriggerToHide
                  position="bottomRight"
                  getPopupContainer={() => container.current?.closest('dialog') || document.body}
                  render={
                    <Dropdown.Menu>
                      <Dropdown.Item
                        disabled={busy || selection.busy}
                        onClick={() => {
                          setMenuOpen(false);
                          void read();
                        }}
                      >
                        全部已读
                      </Dropdown.Item>
                      <Dropdown.Item
                        disabled={busy || selection.busy || !selection.selected.size}
                        onClick={() => {
                          setMenuOpen(false);
                          void read([...selection.selected]);
                        }}
                      >
                        所选标为已读
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  }
                >
                  <MobileMoreButton aria-label="消息操作" title="消息操作" />
                </Dropdown>
              </div>
            </header>
            {model.error && (
              <p className="notice error" role="alert">
                {model.error}
              </p>
            )}
            <div
              className={
                'table-wrap storage-history-list' + (model.mobile ? ' history-mobile-list' : '')
              }
              aria-busy={model.loading}
            >
              {model.mobile ? (
                <RecordList
                  entries={model.items.map((row) => ({
                    id: row.id,
                    title: row.name,
                    status: row.readAt ? 'success' : 'pending',
                    statusLabel: row.readAt ? '已读' : '未读',
                    meta: compactRecordDate(row.createdAt),
                    detail: row.content,
                    onOpen: () => show(row),
                  }))}
                  selection={selection}
                  loading={model.loading}
                  empty="暂无应用内消息"
                />
              ) : (
                <table className="task-table storage-table record-table record-table-compact">
                  <colgroup>
                    <col className="col-selection" />
                    <col />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 160 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>
                        <RecordSelectAll selection={selection} />
                      </th>
                      <th>消息</th>
                      <th>状态</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <RecordSelect selection={selection} id={row.id} name={row.name} />
                        </td>
                        <td>
                          <button type="button" className="text-button" onClick={() => show(row)}>
                            {row.name}
                          </button>
                        </td>
                        <td>
                          <span className={'state-badge ' + (row.readAt ? 'success' : 'pending')}>
                            {row.readAt ? '已读' : '未读'}
                          </span>
                        </td>
                        <td>{compactRecordDate(row.createdAt)}</td>
                      </tr>
                    ))}
                    {!model.loading && !model.items.length && (
                      <tr>
                        <td colSpan={4}>暂无应用内消息</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <RecordFooter model={model} label="应用内消息分页" />
          </>
        )}
      </div>
    </ReactDialog>
  );
}

export function DesktopNotificationInbox(props: { api: ApiClient; toast: Toast; active: boolean }) {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:620px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width:620px)');
    const sync = () => setMobile(media.matches);
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return mobile ? null : <NotificationInbox {...props} menu />;
}
