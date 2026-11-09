import React from 'react';
import type { ApiClient } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import type { HistorySummary, ScanComparison } from './contracts/storage.js';
import { ReactDialog } from './ui/react-dialog.js';
import { NativeSelect } from './native-select.js';
import { TaskPagination } from './task-pagination.js';
import { formatSize } from './terminal-file-model.js';
const labels: Record<string, string> = {
  all: '全部变化',
  added: '新增文件',
  deleted: '删除文件',
  size: '文件大小变化',
  directory: '一级目录增长/减少',
  unconfirmed: '未确认条目',
};
export function ScanComparisonDialog({
  api,
  records,
  onClose,
}: {
  api: ApiClient;
  records: HistorySummary[];
  onClose: () => void;
}) {
  const [before, after] = [...records].sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
  );
  const [result, setResult] = React.useState<ScanComparison | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [kind, setKind] = React.useState('all');
  React.useEffect(() => {
    let stale = false;
    setLoading(true);
    setError('');
    setResult(null);
    const query = new URLSearchParams({
      before: before.id,
      page: String(page),
      pageSize: String(pageSize),
      kind,
    });
    api<ScanComparison>('/storage/scans/' + encodeURIComponent(after.id) + '/comparison?' + query)
      .then((value) => {
        if (!stale) setResult(value);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [page, pageSize, kind]);
  const size = (n: number | null) => (n === null ? '未收录' : formatSize(n));
  return (
    <ReactDialog
      size="large"
      open
      onClose={onClose}
      title="扫描结果对比"
      className="storage-duplicate-dialog"
    >
      <div className="task-form-body">
        <p className="help">
          {before.path}
          <br />
          {before.startedAt} → {after.startedAt}
        </p>
        <NativeSelect
          aria-label="筛选变化"
          value={kind}
          optionList={Object.entries(labels).map(([value, label]) => ({ value, label }))}
          onChange={(value: unknown) => {
            if (typeof value === 'string' && value in labels) {
              setPage(1);
              setKind(value);
            }
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading && <p role="status">正在对比已保存结果…</p>}
        {result && (
          <>
            <p className="help">
              {Object.entries(labels)
                .filter(([key]) => key !== 'all')
                .map(([key, label]) => `${label} ${result.counts[key] || 0}`)
                .join(' · ')}
            </p>
            {result.warning && <p className="help">{result.warning}</p>}
            {(!result.before.complete || !result.after.complete || !result.directoryComplete) && (
              <p role="status" className="form-error">
                扫描未完整覆盖；新增、删除及目录统计可能无法确认。
              </p>
            )}
            <div className="table-wrap">
              <table className="task-table storage-table" aria-label="扫描变化">
                <thead>
                  <tr>
                    <th>路径</th>
                    <th>变化</th>
                    <th>基准大小</th>
                    <th>本次大小</th>
                    <th>增减</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item, i) => (
                    <tr key={item.kind + item.path + i}>
                      <td title={item.path}>
                        <span className="storage-paths">{item.path}</span>
                      </td>
                      <td>
                        {labels[item.kind]}
                        {item.uncertain ? '（不完整）' : ''}
                      </td>
                      <td>{size(item.beforeSize)}</td>
                      <td>{size(item.afterSize)}</td>
                      <td>
                        {item.delta === null
                          ? '无法确认'
                          : `${item.delta > 0 ? '+' : item.delta < 0 ? '−' : ''}${formatSize(Math.abs(item.delta))}`}
                      </td>
                    </tr>
                  ))}
                  {!result.items.length && (
                    <tr>
                      <td colSpan={5}>当前条件下没有已收录变化</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="task-pagination native-pagination history-pagination">
              <TaskPagination
                page={page}
                pageSize={pageSize}
                total={result.total}
                showQuickJumper={false}
                onChange={(next, size) => {
                  setPage(size === pageSize ? next : 1);
                  setPageSize(size);
                }}
              />
            </div>
          </>
        )}
      </div>
      <div className="dialog-footer">
        <button onClick={() => onClose()}>关闭</button>
      </div>
    </ReactDialog>
  );
}
