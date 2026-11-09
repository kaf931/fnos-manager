import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import type { TaskRecord, TaskRun } from './contracts/tasks.js';
import type { ColumnProps, TableProps } from '@douyinfe/semi-ui/lib/es/table/interface';
import { copyText } from './clipboard.js';
import { RecordList } from './record-list.js';
import { TaskPagination } from './task-pagination.js';
import React from 'react';
import SideSheet, { type SideSheetReactProps } from '@douyinfe/semi-ui/lib/es/sideSheet';
const Sheet = (props: SideSheetReactProps) => <SideSheet {...props} />;
import Table from '@douyinfe/semi-ui/lib/es/table';
const RunTable = (props: TableProps<TaskRun>) => <Table<TaskRun> {...props} />;
const h = React.createElement;
const states: Record<string, string> = {
  success: '成功',
  failed: '失败',
  timeout: '超时',
  running: '执行中',
  interrupted: '已中断',
};
const date = (v?: string | null) =>
  v
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(v))
    : '—';
function duration(r: TaskRun) {
  if (!r.finishedAt) return r.status === 'running' ? '进行中' : '—';
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
  return Number.isFinite(ms) ? `${Math.max(0, ms / 1000).toFixed(1)} 秒` : '—';
}
function output(r: TaskRun) {
  return `标准输出\n${r.stdout || '无输出'}\n\n错误输出\n${r.stderr || '无错误输出'}`;
}
export function TaskHistory({
  api,
  toast,
  task,
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  task: TaskRecord | null;
  onClose: () => void;
}) {
  const [rows, setRows] = React.useState<TaskRun[]>([]),
    [selected, setSelected] = React.useState<TaskRun | null>(null),
    [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState(''),
    [tableHeight, setTableHeight] = React.useState(240),
    [page, setPage] = React.useState(1),
    [pageSize, setPageSize] = React.useState(10),
    [mobile, setMobile] = React.useState(matchMedia('(max-width:620px)').matches);
  React.useEffect(() => {
    const query = matchMedia('(max-width:620px)'),
      change = () => setMobile(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const ticket = React.useRef(0),
    trigger = React.useRef<HTMLElement | null>(null),
    tableHost = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!task || !tableHost.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setTableHeight(Math.max(80, Math.floor(entry.contentRect.height) - 40)),
    );
    observer.observe(tableHost.current);
    return () => observer.disconnect();
  }, [task, mobile]);
  async function read(t: TaskRecord | null, reset = false) {
    if (!t) return;
    const n = ++ticket.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<TaskRun[]>(`/tasks/${t.id}/runs`);
      if (n !== ticket.current) return;
      setRows(result);
      setPage((old) => Math.min(old, Math.max(1, Math.ceil(result.length / pageSize))));
      if (reset) {
        setSelected(null);
        setPage(1);
      } else setSelected((old) => (old ? result.find((r) => r.id === old.id) || null : null));
    } catch (e) {
      if (n === ticket.current) setError(errorMessage(e));
    } finally {
      if (n === ticket.current) setLoading(false);
    }
  }
  React.useEffect(() => {
    if (task)
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRows([]);
    setSelected(null);
    setPage(1);
    if (task) void read(task, true);
    return () => {
      ++ticket.current;
    };
  }, [task?.id]);
  function close() {
    ++ticket.current;
    onClose();
    setLoading(false);
    requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus());
  }
  async function copy() {
    try {
      if (!selected) return;
      await copyText(output(selected));
      toast('日志已复制');
    } catch {
      toast('复制失败，请选择日志文本复制');
    }
  }
  const columns: ColumnProps<TaskRun>[] = [
    { title: '执行时间', dataIndex: 'startedAt', width: 165, render: date },
    {
      title: '触发方式',
      dataIndex: 'trigger',
      width: 100,
      render: (v) => (v === 'schedule' ? '计划执行' : '手动执行'),
    },
    {
      title: '结果',
      dataIndex: 'status',
      width: 85,
      render: (v) => h('span', { className: `state-badge ${v}` }, states[v] || v),
    },
    { title: '耗时', key: 'duration', width: 90, render: (_, r) => duration(r) },
    { title: '退出码', dataIndex: 'code', width: 75, render: (v) => v ?? '—' },
    {
      title: '操作',
      key: 'detail',
      width: 90,
      render: (_, r) =>
        h(
          'button',
          {
            type: 'button',
            className: 'text-button',
            onClick: () => setSelected(r),
            'aria-label': `查看 ${date(r.startedAt)} 的执行详情`,
          },
          selected?.id === r.id ? '正在查看' : '查看详情',
        ),
    },
  ];
  return h(
    Sheet,
    {
      visible: !!task,
      placement: mobile ? 'bottom' : 'right',
      width: mobile ? '100vw' : 'min(800px, 100vw)',
      height: mobile ? '92dvh' : undefined,
      className: 'task-history-sheet',
      title: h(
        'div',
        null,
        h('div', null, '执行记录'),
        h('p', { className: 'history-task-name' }, task?.name),
      ),
      'aria-label': '任务执行记录',
      onCancel: close,
      closeOnEsc: true,
      maskClosable: true,
      bodyStyle: { padding: 0 },
      footer: mobile
        ? null
        : h(
            'div',
            {
              id: 'task-history-pagination',
              className: 'native-pagination',
              'aria-label': '执行记录分页',
            },
            h(TaskPagination, {
              page,
              pageSize,
              total: rows.length,
              showQuickJumper: false,
              onChange: (next: number, size: number) => {
                setPage(size !== pageSize ? 1 : next);
                setPageSize(size);
              },
            }),
          ),
      afterVisibleChange: (visible: boolean) => {
        if (!visible && trigger.current?.isConnected) trigger.current.focus();
      },
    },
    h(
      'div',
      { className: 'history-sheet-toolbar' },
      h('span', null, `共 ${rows.length} 条记录 · 中国标准时间`),
      h(
        'button',
        { type: 'button', disabled: loading, onClick: () => read(task) },
        loading ? '读取中…' : '刷新',
      ),
    ),
    error && h('p', { className: 'form-error history-sheet-error', role: 'alert' }, error),
    h(
      'div',
      { className: `history-sheet-table ${mobile ? 'history-mobile-list' : ''}`, ref: tableHost },
      mobile
        ? h(PullRefresh, {
            onRefresh: () => read(task),
            children: h(RecordList, {
              entries: rows.map((r) => ({
                id: r.id,
                title: date(r.startedAt),
                status: r.status,
                statusLabel: states[r.status] || r.status,
                meta: duration(r),
                detail: `${r.trigger === 'schedule' ? '计划执行' : '手动执行'} · 退出码 ${r.code ?? '—'}`,
                onOpen: () => setSelected(r),
              })),
              loading,
              empty: '暂无执行记录',
            }),
          })
        : h(RunTable, {
            rowKey: 'id',
            size: 'small',
            columns,
            dataSource: rows.slice((page - 1) * pageSize, page * pageSize),
            loading,
            empty: loading ? '正在读取执行记录…' : '暂无执行记录',
            scroll: { x: 605, y: tableHeight },
            pagination: false,
            onRow: (r?: TaskRun) => ({
              className: r && r.id === selected?.id ? 'history-row-selected' : '',
            }),
          }),
    ),
    selected &&
      h(
        'section',
        { className: 'history-run-detail', 'aria-label': '执行详情' },
        h(
          'div',
          { className: 'history-detail-heading' },
          h(
            'strong',
            null,
            `${date(selected.startedAt)} · ${states[selected.status] || selected.status}`,
          ),
          h('button', { type: 'button', onClick: copy }, '复制日志'),
          h('button', { type: 'button', onClick: () => setSelected(null) }, '收起详情'),
        ),
        h('pre', { tabIndex: 0, className: 'history-run-output' }, output(selected)),
        selected.truncated &&
          h('p', { className: 'help' }, '输出超过保留上限，仅显示已保存的部分。'),
      ),
    h(
      'p',
      { className: 'history-sheet-footnote' },
      '保留最近 100 条执行记录；单次标准输出和错误输出各最多 64 KB。',
    ),
  );
}

import { PullRefresh } from './pull-refresh.js';
