import { compactRecordDate } from './record-date.js';
import {
  RecordBatchControl,
  useRecordBatch,
  RecordSelectAll,
  RecordSelect,
} from './record-batch.js';
import React from 'react';
import type { NotificationDelivery } from '../backend/domain/notifications.js';
import { useRecordPage, RecordFooter, RecordList } from './record-list.js';
import type { ApiClient } from './contracts/shared.js';
const labels: Record<NotificationDelivery['status'], string> = {
  pending: '等待发送',
  sending: '发送中',
  success: '已接收',
  failed: '失败',
  cancelled: '已取消',
};
const resultLabel = (row: NotificationDelivery) =>
  row.error ||
  (row.channel === 'email'
    ? row.status === 'success'
      ? 'SMTP 已接收'
      : ''
    : row.httpStatus
      ? 'HTTP ' + row.httpStatus
      : '');
const date = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(v))
    : '—';
export function NotificationRecords({
  api,
  active,
  revision,
  batch,
  filters = '',
}: {
  api: ApiClient;
  active: boolean;
  revision: number;
  batch: RecordBatchControl;
  filters?: string;
}) {
  const model = useRecordPage<NotificationDelivery>({
    api,
    path: '/notifications/deliveries',
    active,
    revision,
    filters,
  });
  const selection = useRecordBatch({
    api,
    kind: 'deliveries',
    items: model.items,
    active,
    scope: (model.mobile ? 'mobile' : String(model.page)) + '|' + model.pageSize,
    control: batch,
    refresh: model.refresh,
  });
  const records = { items: model.items, total: model.total };
  const { loading, error, mobile } = model;
  return (
    <section className="storage-history-inline record-content" aria-label="投递记录列表">
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap storage-history-list" aria-busy={loading}>
        {mobile ? (
          <RecordList
            entries={records.items.map((row) => ({
              id: row.id,
              title: row.name,
              status: row.status,
              statusLabel: labels[row.status],
              meta: compactRecordDate(row.createdAt),
              detail: [resultLabel(row), row.templateName, `尝试 ${row.attempts}/3`]
                .filter(Boolean)
                .join(' · '),
            }))}
            selection={selection}
            loading={loading}
            empty="暂无投递记录"
          />
        ) : (
          <table className="task-table storage-table record-table">
            <colgroup>
              <col className="col-selection" />
              <col style={{ width: 180 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 260 }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <RecordSelectAll selection={selection} />
                </th>
                <th>名称</th>
                <th>通知模板</th>
                <th>状态</th>
                <th>尝试次数</th>
                <th>时间</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {records.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <RecordSelect selection={selection} id={row.id} name={row.name} />
                  </td>
                  <td>{row.name}</td>
                  <td>{row.templateName || '默认通知'}</td>
                  <td>
                    <span className={'state-badge ' + row.status}>{labels[row.status]}</span>
                  </td>
                  <td>{row.attempts} / 3</td>
                  <td>{date(row.createdAt)}</td>
                  <td>{resultLabel(row) || '—'}</td>
                </tr>
              ))}
              {!records.items.length && !loading && (
                <tr>
                  <td colSpan={7}>{error ? '记录加载失败' : '暂无投递记录'}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <RecordFooter model={model} label="投递记录分页" />
    </section>
  );
}
