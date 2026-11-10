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
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
}) {
  const [open, setOpen] = useState(false),
    [count, setCount] = useState(0),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) {
      setOpen(false);
      return;
    }
    let live = true;
    const read = async () => {
      try {
        const v = await api<{ count: number }>('/notifications/inbox/unread');
        if (live) setCount(Number.isSafeInteger(v.count) ? v.count : 0);
      } catch {
        /* Opening the list exposes actionable errors; silent background checks do not repeat toasts. */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, active, revision]);
  return (
    <>
      <button
        type="button"
        title="应用内消息"
        className="activity-badge-host"
        aria-label={count ? `应用内消息，${count} 条未读` : '应用内消息'}
        onClick={() => setOpen(true)}
      >
        <AppIcon name="bell" />
        <span className="toolbar-action-label">消息</span>
        {count > 0 && (
          <span className="activity-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {active && open && (
        <InboxDialog
          api={api}
          toast={toast}
          onClose={() => setOpen(false)}
          onChanged={() => setRevision((v) => v + 1)}
        />
      )}
    </>
  );
}
function InboxDialog({
  api,
  toast,
  onClose,
  onChanged,
}: {
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState('all'),
    [menuOpen, setMenuOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<InboxMessage | null>(null),
    [, rerender] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
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
    filters: '&filter=' + filter,
  });
  const selection = useRecordBatch({
    api,
    kind: 'deliveries',
    items: model.items,
    active: true,
    scope: filter + '|' + model.page + '|' + model.pageSize,
    control,
    refresh: () => {
      model.refresh();
      onChanged();
    },
  });
  async function read(ids?: string[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await api(
        ids ? '/notifications/inbox/read' : '/notifications/inbox/read-all',
        'POST',
        ids ? { ids } : {},
      );
      if (alive.current) {
        model.refresh();
        onChanged();
      }
    } catch (e) {
      if (alive.current) toast(errorMessage(e));
    } finally {
      lock.current = false;
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
