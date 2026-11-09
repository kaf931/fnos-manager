import React from 'react';
import { StorageToolbar } from './storage-toolbar.js';
import { AppIcon } from './ui/icon-markup.js';
import ConfigProvider from '@douyinfe/semi-ui/lib/es/configProvider';
import { NativeSelect } from './native-select.js';
import { RecordList } from './record-list.js';
import { TaskPagination } from './task-pagination.js';
import { confirmAction } from './confirmation.js';
import { attachmentSize } from './ai-attachments.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type {
  AiAttachmentPage,
  AiAttachmentListItem,
  AiAttachmentCleanup,
} from '../backend/domain/ai-attachments.js';
export function StorageAttachments({
  api,
  toast,
  onChanged,
  active,
  revision = 0,
}: {
  api: ApiClient;
  toast: Toast;
  onChanged: () => void | Promise<void>;
  active: boolean;
  revision?: number;
}) {
  const alive = React.useRef(active);
  alive.current = active;
  const mounted = React.useRef(true);
  const workingRef = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    alive.current = active;
    return () => {
      mounted.current = false;
      alive.current = false;
    };
  }, []);
  const date = (n: number) => new Date(n).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const [search, setSearch] = React.useState(''),
    [kind, setKind] = React.useState('all'),
    [days, setDays] = React.useState('0');
  const [page, setPage] = React.useState(1),
    [pageSize, setPageSize] = React.useState(10),
    [data, setData] = React.useState<AiAttachmentPage | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]),
    [busy, setBusy] = React.useState(false),
    [loading, setLoading] = React.useState(true),
    [error, setError] = React.useState('');
  const [mobile, setMobile] = React.useState(matchMedia('(max-width:620px)').matches);
  const serial = React.useRef(0);
  const lifecycle = React.useRef(0);
  React.useEffect(() => {
    ++lifecycle.current;
    setSelected([]);
    if (active && mobile) {
      setPage(1);
      setData(null);
    }
    return () => {
      ++lifecycle.current;
    };
  }, [active]);
  React.useEffect(() => {
    if (mobile) {
      setPage(1);
      setSelected([]);
    }
  }, [revision]);
  const current = () => alive.current;
  React.useEffect(() => {
    const media = matchMedia('(max-width:620px)'),
      change = () => {
        setMobile(media.matches);
        setPage(1);
        setSelected([]);
      };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  async function read(append = false) {
    if (!current()) return;
    const request = ++serial.current;
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
        kind,
        olderThanDays: days,
      });
      const next = await api<AiAttachmentPage>('/storage/attachments?' + q);
      if (!current() || request !== serial.current) return;
      setData((old) => ({
        ...next,
        items: append && old ? [...old.items, ...next.items] : next.items,
      }));
      setSelected((ids) =>
        append ? ids : ids.filter((id) => next.items.some((a) => a.id === id && !a.inUse)),
      );
      if (!next.items.length && page > 1 && !append) setPage(page - 1);
    } catch (e) {
      if (current() && request === serial.current) setError(errorMessage(e));
    } finally {
      if (current() && request === serial.current) setLoading(false);
    }
  }
  React.useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void read(mobile && page > 1), 150);
    return () => {
      clearTimeout(timer);
      serial.current++;
    };
  }, [search, kind, days, page, pageSize, mobile, active, revision]);
  const changeFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
    setSelected([]);
  };

  const selectable = data?.items.filter((a) => !a.inUse) || [];
  const allSelected =
    !!selectable.length &&
    selectable.filter((a) => selected.includes(a.id)).length === Math.min(selectable.length, 200);
  const toggle = (id: string, checked: boolean) => {
    if (checked && !selected.includes(id) && selected.length >= 200) {
      toast('每批最多选择 200 个附件');
      return;
    }
    setSelected((ids) =>
      checked ? [...new Set([...ids, id])].slice(0, 200) : ids.filter((x) => x !== id),
    );
  };
  const checkbox = (a: AiAttachmentListItem) => (
    <input
      type="checkbox"
      aria-label={'选择附件 ' + a.name}
      disabled={busy || loading || a.inUse}
      checked={selected.includes(a.id)}
      onChange={(e) => toggle(a.id, e.target.checked)}
    />
  );
  async function clean() {
    if (workingRef.current || !selected.length) return;
    const ids = [...selected],
      ticket = lifecycle.current;
    const accepted = await confirmAction({
      title: '清理附件',
      text: `清理选中的 ${ids.length} 个附件，聊天文字会保留。`,
      danger: true,
      accept: '清理',
      onAccept: async () => {
        if (!current() || ticket !== lifecycle.current || workingRef.current) return;
        workingRef.current = true;
        setBusy(true);
        try {
          const result = await api<AiAttachmentCleanup>('/storage/attachments/delete', 'POST', {
            ids,
            confirmed: true,
          });
          if (!current()) return;
          toast(
            result.cleanupPending
              ? '附件引用已移除，部分文件待后续清理重试'
              : `已清理 ${result.count} 个附件`,
          );
          setSelected([]);
          await Promise.resolve(onChanged()).catch((e) => toast(errorMessage(e)));
          if (mobile && page !== 1) setPage(1);
          else await read();
        } finally {
          workingRef.current = false;
          if (mounted.current) setBusy(false);
        }
      },
    });
    if (!accepted) return;
  }
  return (
    <ConfigProvider getPopupContainer={() => document.body}>
      <section className="storage-history-inline" aria-label="应用附件">
        <StorageToolbar>
          <button
            aria-label="批量管理"
            title="批量管理"
            className="toolbar-manage"
            disabled={busy || !selected.length}
            onClick={() => void clean()}
          >
            <AppIcon name="grid" />
            <span className="toolbar-action-label">批量管理</span>
          </button>
        </StorageToolbar>
        <div className="toolbar task-toolbar">
          <div className="task-toolbar-filters">
            <div className="search">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                type="search"
                aria-label="搜索附件名称或会话"
                placeholder="搜索名称或会话"
                value={search}
                disabled={busy}
                onChange={(e) => changeFilter(setSearch)(e.target.value)}
              />
            </div>
            <div className="toolbar-select-group">
              <div className="toolbar-select">
                <NativeSelect
                  aria-label="附件类型"
                  value={kind}
                  disabled={busy}
                  optionList={[
                    { value: 'all', label: '全部类型' },
                    { value: 'text', label: '文本' },
                    { value: 'image', label: '图片' },
                    { value: 'archive', label: '技能包' },
                  ]}
                  onChange={changeFilter(setKind)}
                />
              </div>
              <div className="toolbar-select">
                <NativeSelect
                  aria-label="附件时间"
                  value={days}
                  disabled={busy}
                  optionList={[
                    { value: '0', label: '全部时间' },
                    { value: '7', label: '7 天前' },
                    { value: '30', label: '30 天前' },
                    { value: '90', label: '90 天前' },
                  ]}
                  onChange={changeFilter(setDays)}
                />
              </div>
            </div>
          </div>
        </div>
        {loading && (
          <p className="help" role="status">
            正在读取附件…
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void read(mobile && page > 1)}
            >
              重试
            </button>
          </p>
        )}
        <div className="table-wrap storage-history-list" aria-busy={loading}>
          {mobile ? (
            <RecordList
              entries={(data?.items ?? []).map((a) => ({
                id: a.id,
                selects: true,
                title: a.name,
                status: '',
                statusLabel: a.inUse ? '使用中' : '',
                meta: attachmentSize(a.size),
                detail: [
                  a.kind === 'archive' ? '技能包' : a.kind === 'image' ? '图片' : '文本',
                  date(a.createdAt),
                  a.chatTitle,
                ].join(' · '),
                onOpen: () => {
                  if (!busy && !loading && !a.inUse) toggle(a.id, !selected.includes(a.id));
                },
              }))}
              selection={{
                limit: 200,
                selected: new Set(selected),
                eligible: new Set(selectable.map((a) => a.id)),
                busy: busy || loading,
                toggle: (id) => toggle(id, !selected.includes(id)),
                toggleAll: () =>
                  setSelected(allSelected ? [] : selectable.slice(0, 200).map((a) => a.id)),
              }}
              loading={loading}
              empty="暂无附件"
            />
          ) : (
            <table className="task-table storage-table storage-history-table">
              <thead>
                <tr>
                  <th className="col-selection">
                    <input
                      type="checkbox"
                      aria-label="选择本页全部附件"
                      disabled={busy || loading || !selectable.length}
                      checked={allSelected}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? selectable.slice(0, 200).map((a) => a.id) : [],
                        )
                      }
                    />
                  </th>
                  <th>名称</th>
                  <th className="col-kind">类型</th>
                  <th className="col-size">大小</th>
                  <th className="col-context">会话</th>
                  <th className="col-date">添加时间</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((a) => (
                  <tr key={a.id}>
                    <td className="col-selection">{checkbox(a)}</td>
                    <td title={a.name}>{a.name}</td>
                    <td>
                      {a.kind === 'archive' ? '技能包' : a.kind === 'image' ? '图片' : '文本'}
                    </td>
                    <td>{attachmentSize(a.size)}</td>
                    <td title={a.chatTitle}>
                      {a.chatTitle}
                      {a.inUse ? ' · AI 处理中' : ''}
                    </td>
                    <td title={date(a.createdAt)}>{date(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!mobile && !data?.items.length && !loading && !error && <p className="help">暂无附件</p>}
        </div>
        {mobile ? (
          !error &&
          data &&
          data.items.length < data.total && (
            <button type="button" disabled={busy || loading} onClick={() => setPage(page + 1)}>
              加载更多
            </button>
          )
        ) : (
          <div
            className="task-pagination native-pagination history-pagination"
            aria-label="应用附件分页"
          >
            <TaskPagination
              page={page}
              pageSize={pageSize}
              total={data?.total || 0}
              onChange={(next, size) => {
                if (busy || loading) return;
                setSelected([]);
                setPage(size !== pageSize ? 1 : next);
                setPageSize(size);
              }}
            />
          </div>
        )}
      </section>
    </ConfigProvider>
  );
}
