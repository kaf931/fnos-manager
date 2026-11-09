import { compactRecordDate } from './record-date.js';
import { RecordList } from './record-list.js';
import { ScanComparisonDialog } from './storage-comparison.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import type {
  HistoryRecord,
  HistorySummary,
  ScanRecord,
  StoragePage,
} from './contracts/storage.js';
import { selectHistoryRecords } from './storage-history-selection.js';
import { confirmAction } from './confirmation.js';
import React from 'react';
import { AppIcon } from './ui/icon-markup.js';
import { StorageToolbar } from './storage-toolbar.js';
import { TaskPagination } from './task-pagination.js';
import { formatSize } from './terminal-file-model.js';
const h = React.createElement,
  statuses: Record<string, string> = {
    running: '扫描中',
    completed: '已完成',
    limited: '扫描不完整',
    failed: '扫描失败',
    cancelled: '已取消',
    partial: '部分完成',
    interrupted: '已中断',
  },
  tones: Record<string, string> = {
    running: 'running',
    completed: 'success',
    limited: 'timeout',
    failed: 'failed',
    cancelled: 'interrupted',
    partial: 'timeout',
    interrupted: 'interrupted',
  };
const date = (value: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value)),
  kind = (row: HistorySummary) =>
    row.mode === 'rename'
      ? row.operation === 'undo'
        ? '撤销改名'
        : '批量改名'
      : row.mode === 'space'
        ? '空间分析'
        : '重复文件';
interface HistoryOptions<R extends HistoryRecord> {
  api: ApiClient;
  onSelect: (record: R) => void | Promise<void>;
  toast: Toast;
  active: boolean;
  revision?: number;
  onClose?: () => void;

  source?: string;
  title?: string;
  modeFilter?: string | null;
  managementOnly?: boolean;
  onDeleted?: (ids: string[]) => void | Promise<void>;
}
export function StorageHistory<R extends HistoryRecord = ScanRecord>({
  api,
  onSelect,
  toast,
  active,
  revision = 0,
  onClose,
  source = '/storage/scans',
  title = '扫描记录',
  modeFilter = null,
  managementOnly = false,
  onDeleted,
}: HistoryOptions<R>) {
  const [comparison, setComparison] = React.useState<HistorySummary[] | null>(null);
  const [visible, setVisible] = React.useState(false),
    [rows, setRows] = React.useState<HistorySummary[]>([]),
    [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState(''),
    [restoring, setRestoring] = React.useState<string | null>(null),
    [page, setPage] = React.useState(1),
    [pageSize, setPageSize] = React.useState(10),
    [total, setTotal] = React.useState(0),
    [mobileLimit, setMobileLimit] = React.useState(50),
    [mobile, setMobile] = React.useState(matchMedia('(max-width:620px)').matches);
  const [selected, setSelected] = React.useState<string[]>([]),
    [deleting, setDeleting] = React.useState(false);
  const epoch = React.useRef(0),
    lifecycle = React.useRef(0),
    open = React.useRef(false),
    restoringId = React.useRef<string | null>(null),
    selectedIds = React.useRef<string[]>([]),
    knownRecords = React.useRef(new Map<string, HistorySummary>()),
    paging = React.useRef({ page: 1, pageSize: 10, mobile, mobileLimit: 50 });
  paging.current = { page, pageSize, mobile, mobileLimit };
  selectedIds.current = selected;
  for (const id of knownRecords.current.keys()) {
    if (!selected.includes(id)) knownRecords.current.delete(id);
  }
  rows.forEach((row) => knownRecords.current.set(row.id, row));
  function changeSelection(change: { add?: readonly string[]; remove?: readonly string[] }) {
    const result = selectHistoryRecords(selectedIds.current, change);
    selectedIds.current = result.ids;
    setSelected(result.ids);
    if (result.limited) toast('每次最多选择 200 条记录');
  }
  React.useEffect(() => {
    const media = matchMedia('(max-width:620px)'),
      change = () => {
        setMobile(media.matches);
        if (open.current) read({ mobile: media.matches });
      };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  async function read(options: Partial<typeof paging.current> = {}): Promise<void> {
    const requested = { ...paging.current, ...options };
    const ticket = ++epoch.current;
    setLoading(true);
    setError('');
    try {
      const size = requested.mobile ? Math.min(requested.mobileLimit, 200) : requested.pageSize;
      const firstPage = requested.mobile ? 1 : requested.page;
      const query = new URLSearchParams({ page: String(firstPage), pageSize: String(size) });
      if (modeFilter) query.set('mode', modeFilter);
      const result = await api<StoragePage<HistorySummary>>(source + '?' + query);
      if (ticket !== epoch.current || !open.current) return;
      const records = [...result.items];
      if (requested.mobile) {
        for (let next = 2; records.length < Math.min(requested.mobileLimit, result.total); next++) {
          query.set('page', String(next));
          const extra = await api<StoragePage<HistorySummary>>(source + '?' + query);
          if (ticket !== epoch.current || !open.current) return;
          records.push(...extra.items);
          if (!extra.items.length) break;
        }
        records.length = Math.min(records.length, requested.mobileLimit);
      } else {
        const lastPage = Math.max(1, Math.ceil(result.total / size));
        if (firstPage > lastPage) {
          setPage(lastPage);
          return read({ ...requested, page: lastPage });
        }
      }
      setRows(records);
      setTotal(result.total);
      changeSelection({ remove: records.filter((r) => r.status === 'running').map((r) => r.id) });
    } catch (e) {
      if (ticket === epoch.current && open.current) setError(errorMessage(e));
    } finally {
      if (ticket === epoch.current && open.current) setLoading(false);
    }
  }
  React.useEffect(() => {
    if (!visible || !rows.some((r) => r.status === 'running')) return;
    const timer = setTimeout(() => void read(), 2000);
    return () => clearTimeout(timer);
  }, [visible, rows]);
  function close() {
    ++lifecycle.current;
    open.current = false;
    ++epoch.current;
    setVisible(false);
    onClose?.();
    setLoading(false);
    restoringId.current = null;
    setRestoring(null);
  }
  React.useEffect(() => {
    open.current = active;
    setVisible(active);
    if (!active) setComparison(null);
    ++lifecycle.current;
    if (active) void read();
    return () => {
      open.current = false;
      ++epoch.current;
      ++lifecycle.current;
    };
  }, [active, revision, source]);
  async function select(row: HistorySummary) {
    if (restoringId.current) return;
    const ticket = lifecycle.current;
    restoringId.current = row.id;
    setRestoring(row.id);
    try {
      const result = await api<R>(source + '/' + row.id);
      if (!open.current || ticket !== lifecycle.current || restoringId.current !== row.id) return;
      await onSelect(result);
      close();
    } catch (e) {
      if (open.current && ticket === lifecycle.current) toast(errorMessage(e));
    } finally {
      if (ticket === lifecycle.current && restoringId.current === row.id) {
        restoringId.current = null;
        setRestoring(null);
      }
    }
  }
  function deleteSelected() {
    const ids = [...selected],
      ticket = lifecycle.current;
    confirmAction({
      title: '批量管理',
      text: source.includes('/rename/')
        ? '仅删除改名记录，文件名称保持不变。删除后无法通过这些记录撤销改名。'
        : '仅删除扫描记录，不会删除或修改文件。',
      accept: '删除记录',
      cancel: '取消',
      danger: true,
      onAccept: async () => {
        if (!open.current || ticket !== lifecycle.current) return;
        setDeleting(true);
        try {
          await api(source + '/delete', 'POST', { ids, confirmed: true });
          if (!open.current || ticket !== lifecycle.current) return;
          changeSelection({ remove: selectedIds.current });
          await read();
          await onDeleted?.(ids);
          toast('已删除 ' + ids.length + ' 条记录');
        } catch (e) {
          toast(errorMessage(e));
          throw e;
        } finally {
          setDeleting(false);
        }
      },
    });
  }
  const badge = (r: HistorySummary) =>
      h(
        'span',
        { className: 'state-badge ' + (tones[r.status] || '') },
        statuses[r.status] || r.status,
      ),
    viewButton = (r: HistorySummary) =>
      h(
        'button',
        {
          type: 'button',
          className: 'text-button',
          disabled: !!restoring,
          onClick: () => select(r),
          'aria-label': `查看 ${date(r.startedAt)} ${kind(r)}的结果`,
        },
        restoring === r.id ? '读取中…' : '查看结果',
      );
  const compareButton = h(
    'button',
    {
      type: 'button',
      className: 'toolbar-manage',
      title: '对比所选两次扫描',
      'aria-label': '对比所选两次扫描',
      disabled:
        loading ||
        deleting ||
        selected.length !== 2 ||
        selected.some((id) => {
          const row = knownRecords.current.get(id);
          return row?.mode !== 'space' || row.status !== 'completed';
        }),
      onClick: () =>
        setComparison(selected.map((id) => knownRecords.current.get(id)!).filter(Boolean)),
    },
    h(AppIcon, { name: 'compare' }),
    h('span', { className: 'toolbar-action-label' }, '对比所选两次扫描'),
  );
  const filtered = rows;
  const columns: {
    title: string;
    dataIndex?: string;
    width: number;
    render: (row: HistorySummary) => React.ReactNode;
  }[] = [
    { title: '时间', width: 150, render: (r: HistorySummary) => date(r.startedAt) },
    { title: '类型', width: 90, render: (r: HistorySummary) => kind(r) },
    {
      title: '目录',
      dataIndex: 'path',
      width: 220,
      render: (r: HistorySummary) =>
        h('span', { title: r.path, className: 'storage-history-path' }, r.path),
    },
    { title: '状态', width: 100, render: (r: HistorySummary) => badge(r) },
    { title: '文件数', width: 75, render: (r: HistorySummary) => r.progress?.files ?? 0 },
    { title: '操作', width: 90, render: (r: HistorySummary) => viewButton(r) },
  ].filter((c) => !managementOnly || c.title !== '操作');
  const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const footer = mobile
    ? null
    : h(
        'div',
        {
          className: 'task-pagination native-pagination history-pagination',
          'aria-label': title + '分页',
        },
        h(TaskPagination, {
          page: current,
          pageSize,
          total,
          showQuickJumper: false,
          onChange: (next: number, size: number) => {
            const requestedPage = size !== pageSize ? 1 : next;
            setPage(requestedPage);
            setPageSize(size);
            read({ page: requestedPage, pageSize: size });
          },
        }),
      );
  return h(
    'section',
    { className: 'storage-history-inline', hidden: !visible, 'aria-label': title },
    h('h2', { className: 'storage-records-title' }, title),
    h(
      StorageToolbar,
      null,
      h(
        'button',
        {
          className: 'toolbar-manage',
          'aria-label': managementOnly ? '删除所选记录' : '批量管理',
          title: managementOnly ? '删除所选记录' : '批量管理',
          disabled: deleting || !selected.length,
          onClick: deleteSelected,
        },
        h(AppIcon, { name: managementOnly ? 'trash' : 'grid' }),
        h(
          'span',
          { className: 'toolbar-action-label' },
          managementOnly ? '删除所选记录' : '批量管理',
        ),
      ),
      source === '/storage/scans' && visible && !managementOnly && compareButton,
    ),
    comparison &&
      h(ScanComparisonDialog, { api, records: comparison, onClose: () => setComparison(null) }),

    error && h('p', { className: 'form-error history-sheet-error', role: 'alert' }, error),
    h(
      'div',
      {
        className: 'table-wrap storage-history-list' + (mobile ? ' history-mobile-list' : ''),
      },
      mobile
        ? h(RecordList, {
            entries: filtered.map((r) => ({
              id: r.id,
              selects: managementOnly,
              title: kind(r) + ' · ' + r.path,
              status: tones[r.status] ?? '',
              statusLabel: statuses[r.status] ?? r.status,
              meta: compactRecordDate(r.startedAt),
              detail:
                r.error ||
                `${r.progress?.files ?? 0} 个文件 · ${formatSize(r.progress?.bytes ?? 0)}`,
              onOpen: managementOnly
                ? () => {
                    if (r.status !== 'running' && !deleting)
                      changeSelection({
                        [selectedIds.current.includes(r.id) ? 'remove' : 'add']: [r.id],
                      });
                  }
                : () => select(r),
            })),
            selection: {
              selected: new Set(selected),
              eligible: new Set(filtered.filter((r) => r.status !== 'running').map((r) => r.id)),
              busy: deleting,
              toggle: (id: string) =>
                changeSelection({
                  [selectedIds.current.includes(id) ? 'remove' : 'add']: [id],
                }),
              toggleAll: () => {
                const eligible = filtered.filter((r) => r.status !== 'running').map((r) => r.id);
                changeSelection({
                  [eligible.every((id) => selected.includes(id)) ? 'remove' : 'add']: eligible,
                });
              },
            },
            loading,
            empty: '暂无' + title,
          })
        : h(
            'table',
            {
              className:
                'task-table storage-table storage-history-table' +
                (managementOnly ? ' dialog-table compact-table' : ''),
              'aria-label': title,
            },
            h(
              'colgroup',
              null,
              h('col', { className: 'col-selection', style: { width: 40 } }),
              ...columns.map((c, i) =>
                h('col', {
                  key: i,
                  style: c.dataIndex === 'path' ? undefined : { width: c.width },
                }),
              ),
            ),
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h(
                  'th',
                  { className: 'col-selection' },
                  h('input', {
                    type: 'checkbox',
                    'aria-label': '选择当前页记录',
                    disabled: deleting || !filtered.some((r) => r.status !== 'running'),
                    checked:
                      filtered.filter((r) => r.status !== 'running').length > 0 &&
                      filtered
                        .filter((r) => r.status !== 'running')
                        .every((r) => selected.includes(r.id)),
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                      const ids = filtered.filter((r) => r.status !== 'running').map((r) => r.id);
                      changeSelection({ [e.target.checked ? 'add' : 'remove']: ids });
                    },
                  }),
                ),
                ...columns.map((c, i) => h('th', { key: i }, c.title)),
              ),
            ),
            h(
              'tbody',
              null,
              filtered.length
                ? filtered.map((r) =>
                    h(
                      'tr',
                      { key: r.id },
                      h(
                        'td',
                        { className: 'col-selection' },
                        h('input', {
                          type: 'checkbox',
                          checked: selected.includes(r.id),
                          disabled: r.status === 'running' || deleting,
                          'aria-label': '选择 ' + date(r.startedAt) + ' ' + kind(r) + ' 的记录',
                          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                            changeSelection({ [e.target.checked ? 'add' : 'remove']: [r.id] }),
                        }),
                      ),
                      ...columns.map((c, i) => h('td', { key: i }, c.render(r))),
                    ),
                  )
                : h(
                    'tr',
                    null,
                    h(
                      'td',
                      { colSpan: columns.length + 1 },
                      loading ? '正在读取' + title + '…' : '暂无' + title,
                    ),
                  ),
            ),
          ),
    ),
    mobile &&
      rows.length < total &&
      h(
        'button',
        {
          type: 'button',
          className: 'text-button storage-history-load-more',
          disabled: loading,
          onClick: () => {
            const next = mobileLimit + 50;
            setMobileLimit(next);
            read({ mobileLimit: next });
          },
        },
        loading ? '正在读取…' : '加载更多',
      ),
    footer,
  );
}
