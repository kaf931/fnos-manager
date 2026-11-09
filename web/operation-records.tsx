import { compactRecordDate } from './record-date.js';
import {
  RecordBatchControl,
  useRecordBatch,
  RecordSelectAll,
  RecordSelect,
} from './record-batch.js';
import React, { useState } from 'react';
import {
  operationActions,
  operationStatuses,
  type OperationAction,
  type OperationStatus,
  type OperationRecord,
} from '../backend/domain/operations.js';
import { NativeSelect } from './native-select.js';
import { useRecordPage, RecordFooter, RecordList } from './record-list.js';
import type { ApiClient } from './contracts/shared.js';
const actions: Record<OperationAction, string> = {
  'ssh.delete': '删除远程文件',
  'ssh.rename': '改名远程文件',
  'storage.rename': '批量改名',
  'storage.undo': '撤销改名',
  'storage.duplicates.delete': '删除重复副本',
  'storage.duplicates.move': '移动重复副本',
  'backup.restore': '恢复配置',
  'device.reboot': '重启设备',
  'device.shutdown': '关闭设备',
  'ai.command': 'AI 命令',
  'ai.skill': 'AI 技能操作',
};
const statuses: Record<OperationStatus, string> = {
  running: '进行中',
  success: '成功',
  partial: '部分完成',
  failed: '失败',
  interrupted: '已中断',
};
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
export function OperationRecords({
  api,
  active,
  revision,
  batch,
}: {
  api: ApiClient;
  active: boolean;
  revision: number;
  batch: RecordBatchControl;
}) {
  const [action, setAction] = useState('all'),
    [status, setStatus] = useState('all');
  const model = useRecordPage<OperationRecord>({
    api,
    path: '/operations',
    active,
    revision,
    filters: '&action=' + encodeURIComponent(action) + '&status=' + encodeURIComponent(status),
  });
  const selection = useRecordBatch({
    api,
    kind: 'operations',
    items: model.items,
    active,
    scope:
      action +
      '|' +
      status +
      '|' +
      (model.mobile ? 'mobile' : String(model.page)) +
      '|' +
      model.pageSize,
    control: batch,
    refresh: model.refresh,
  });
  const records = { items: model.items, total: model.total };
  const { loading, error, mobile } = model;
  return (
    <section className="storage-history-inline record-content" aria-label="操作记录列表">
      <div className="record-toolbar" role="group" aria-label="记录筛选">
        <NativeSelect
          aria-label="操作类型"
          value={action}
          optionList={[
            { value: 'all', label: '全部操作' },
            ...operationActions.map((value) => ({ value, label: actions[value] })),
          ]}
          onChange={(value) => {
            setAction(value);
          }}
        />
        <NativeSelect
          aria-label="操作结果"
          value={status}
          optionList={[
            { value: 'all', label: '全部结果' },
            ...operationStatuses.map((value) => ({ value, label: statuses[value] })),
          ]}
          onChange={(value) => {
            setStatus(value);
          }}
        />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div
        className={'table-wrap storage-history-list' + (mobile ? ' history-mobile-list' : '')}
        aria-busy={loading}
      >
        {mobile ? (
          <RecordList
            entries={records.items.map((row) => ({
              id: row.id,
              title: actions[row.action],
              status: row.status,
              statusLabel: statuses[row.status],
              meta: compactRecordDate(row.startedAt),
              detail: [row.target, row.summary].filter(Boolean).join(' · '),
            }))}
            selection={selection}
            loading={loading}
            empty="暂无操作记录"
          />
        ) : (
          <table className="task-table storage-table record-table">
            <colgroup>
              <col className="col-selection" />
              <col style={{ width: 150 }} />
              <col style={{ width: 240 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 220 }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <RecordSelectAll selection={selection} />
                </th>
                <th>操作</th>
                <th>目标</th>
                <th>结果</th>
                <th>开始时间</th>
                <th>结束时间</th>
                <th>摘要</th>
              </tr>
            </thead>
            <tbody>
              {records.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <RecordSelect selection={selection} id={row.id} name={actions[row.action]} />
                  </td>
                  <td>{actions[row.action]}</td>
                  <td title={row.target || undefined}>{row.target || '—'}</td>
                  <td>
                    <span
                      className={
                        'state-badge ' +
                        (row.status === 'success'
                          ? 'success'
                          : row.status === 'failed'
                            ? 'failed'
                            : '')
                      }
                    >
                      {statuses[row.status]}
                    </span>
                  </td>
                  <td>{date(row.startedAt)}</td>
                  <td>{date(row.finishedAt)}</td>
                  <td>{row.summary || '—'}</td>
                </tr>
              ))}
              {!records.items.length && !loading && (
                <tr>
                  <td colSpan={7}>{error ? '记录加载失败' : '暂无操作记录'}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <RecordFooter model={model} label="操作记录分页" />
    </section>
  );
}
