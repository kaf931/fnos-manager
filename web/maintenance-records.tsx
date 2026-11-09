import { compactRecordDate } from './record-date.js';
import {
  RecordBatchControl,
  useRecordBatch,
  RecordSelectAll,
  RecordSelect,
  type RecordSelection,
} from './record-batch.js';
import { renderAiMarkdown } from './ai-markdown.js';
import React, { useEffect, useState } from 'react';
import type {
  MaintenanceDetailKind,
  MaintenanceRecord,
  MaintenanceRecordDetail,
} from '../backend/domain/maintenance.js';
import { useRecordPage, RecordFooter, RecordList } from './record-list.js';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ApiClient } from './contracts/shared.js';
export const maintenanceRecordModes = {
  'task-runs': 'taskRuns',
  'restore-receipts': 'restoreReceipts',
  'service-log': 'serviceLog',
  'update-cache': 'updateCache',
  'ai-chats': 'aiHistory',
} as const;
export const isMaintenanceRecordMode = (
  mode: string,
): mode is keyof typeof maintenanceRecordModes => Object.hasOwn(maintenanceRecordModes, mode);
const statuses: Record<string, string> = {
  running: '进行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  interrupted: '已中断',
  protected: '保护期内',
  'in-use': '使用中',
  available: '可查看',
};
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—';
export function MaintenanceRecordRows({
  items,
  onOpen,
  selection,
}: {
  items: MaintenanceRecord[];
  onOpen: (id: string) => void;
  selection?: RecordSelection;
}) {
  return (
    <>
      {items.map((row) => (
        <tr key={row.id}>
          {selection && (
            <td>
              <RecordSelect selection={selection} id={row.id} name={row.name} />
            </td>
          )}
          <td>
            <button
              type="button"
              className="text-button"
              title={row.name}
              onClick={() => onOpen(row.id)}
            >
              {row.name}
            </button>
          </td>
          <td>
            <span className={'state-badge ' + row.status}>
              {statuses[row.status] ?? row.status}
            </span>
          </td>
          <td>{date(row.createdAt)}</td>
          <td>
            {row.summary}
            {row.bytes !== null ? ' · ' + (row.bytes / 1024).toFixed(1) + ' KiB' : ''}
          </td>
        </tr>
      ))}
    </>
  );
}
export function MaintenanceRecords({
  api,
  kind,
  revision,
  batch,
}: {
  api: ApiClient;
  kind: MaintenanceDetailKind | null;
  revision: number;
  batch: RecordBatchControl;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const model = useRecordPage<MaintenanceRecord>({
    api,
    path: '/storage/cleanup/records/' + (kind ?? 'taskRuns'),
    active: kind !== null,
    revision,
  });
  const selection = useRecordBatch({
    api,
    kind: kind ?? 'taskRuns',
    items: model.items,
    active: kind !== null,
    scope: (kind ?? 'closed') + '|' + (model.mobile ? 'mobile' : model.page) + '|' + model.pageSize,
    control: batch,
    refresh: model.refresh,
  });
  return (
    <section
      className="storage-history-inline record-content"
      aria-label="应用记录详情"
      aria-busy={model.loading}
    >
      {model.error && (
        <p className="notice error" role="alert">
          {model.error}
        </p>
      )}
      <div
        className={'table-wrap storage-history-list' + (model.mobile ? ' history-mobile-list' : '')}
      >
        {model.mobile ? (
          <RecordList
            entries={model.items.map((row) => ({
              id: row.id,
              title: row.name,
              status: row.status,
              statusLabel: statuses[row.status] ?? row.status,
              meta: compactRecordDate(row.createdAt),
              detail: row.summary,
              onOpen: () => setSelected(row.id),
            }))}
            selection={selection}
            loading={model.loading}
            empty="暂无记录"
          />
        ) : (
          <table className="task-table storage-table record-table">
            <colgroup>
              <col className="col-selection" />
              <col />
              <col className="col-size" />
              <col className="col-context" />
              <col className="col-context" />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <RecordSelectAll selection={selection} />
                </th>
                <th>名称</th>
                <th>状态</th>
                <th>时间</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <MaintenanceRecordRows
                items={model.items}
                onOpen={setSelected}
                selection={selection}
              />
              {!model.items.length && !model.loading && (
                <tr>
                  <td colSpan={5}>{model.error ? '记录加载失败' : '暂无记录'}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <RecordFooter model={model} label="应用记录分页" />
      {selected && kind && (
        <RecordDialog
          key={kind + ':' + selected}
          api={api}
          kind={kind}
          id={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
function RecordDialog({
  api,
  kind,
  id,
  onClose,
}: {
  api: ApiClient;
  kind: MaintenanceDetailKind;
  id: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<MaintenanceRecordDetail | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api<MaintenanceRecordDetail>('/storage/cleanup/records/' + kind + '/' + encodeURIComponent(id))
      .then((value) => {
        if (live) setData(value);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [api, kind, id]);
  return (
    <ReactDialog open onClose={onClose} title={data?.record.name ?? '记录详情'}>
      <div className="task-form-body">
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : data ? (
          <>
            {data.truncated && (
              <p className="notice" role="status">
                {kind === 'serviceLog'
                  ? '仅显示末尾 64 KiB'
                  : kind === 'aiHistory'
                    ? '对话较长，仅显示部分内容'
                    : '内容较长，仅显示部分输出'}
              </p>
            )}
            <>
              {data.format === 'markdown' ? (
                <div
                  className="ai-markdown"
                  tabIndex={0}
                  dangerouslySetInnerHTML={{ __html: renderAiMarkdown(data.text) }}
                />
              ) : (
                <pre className="history-run-output" tabIndex={0}>
                  {data.text || '暂无内容'}
                </pre>
              )}
            </>
          </>
        ) : (
          <p className="notice" role="status">
            正在读取详情…
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <button type="button" onClick={() => onClose()}>
          关闭
        </button>
      </div>
    </ReactDialog>
  );
}
