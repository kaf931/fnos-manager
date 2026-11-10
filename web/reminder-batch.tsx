import { RecordList } from './record-list.js';
import { useState, useRef, useEffect } from 'react';
import type { Reminder } from '../backend/domain/reminders.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import { ReactDialog } from './ui/react-dialog.js';
import { NativeSelect } from './native-select.js';
import { RecordSelect, RecordSelectAll, type RecordSelection } from './record-batch.js';
import { confirmAction } from './confirmation.js';
import { compactRecordDate } from './record-date.js';
export function ReminderBatch({
  rows,
  api,
  toast,
  onClose,
  onSaved,
}: {
  rows: Reminder[];
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:620px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width:620px)');
    const sync = () => setMobile(media.matches);
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  const [ids, setIds] = useState(new Set<string>()),
    [action, setAction] = useState('complete'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const selection: RecordSelection = {
    selected: ids,
    eligible: new Set(rows.map((row) => row.id)),
    busy,
    limit: 200,
    allLabel: '选择前 200 项',
    toggle: (id) =>
      setIds((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else if (next.size < 200) next.add(id);
        return next;
      }),
    toggleAll: () =>
      setIds((old) => (old.size ? new Set() : new Set(rows.slice(0, 200).map((row) => row.id)))),
  };
  async function execute() {
    if (lock.current || !ids.size) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (
        action === 'delete' &&
        !(await confirmAction({
          title: '删除提醒事项',
          text: `删除所选 ${ids.size} 个事项？历史投递记录将保留。`,
          danger: true,
          accept: '删除',
        }))
      )
        return;
      await api('/notifications/reminders/batch', 'POST', { ids: [...ids], action });
      toast('批量操作已完成');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ReactDialog
      open
      title="批量管理提醒事项"
      size="large"
      layout="workspace"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <span>已选择 {ids.size} 项</span>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={action === 'delete' ? 'danger' : 'primary'}
            disabled={busy || !ids.size}
            onClick={() => void execute()}
          >
            执行
          </button>
        </>
      }
    >
      <div className="task-form-body tool-page record-content">
        <label id="reminder-batch-action-label">处理方式</label>
        <NativeSelect
          aria-labelledby="reminder-batch-action-label"
          value={action}
          disabled={busy}
          optionList={[
            { value: 'complete', label: '标记完成' },
            { value: 'pause', label: '暂停提醒' },
            { value: 'delete', label: '删除事项' },
          ]}
          onChange={setAction}
        />
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className={'table-wrap storage-history-list' + (mobile ? ' history-mobile-list' : '')}>
          {mobile ? (
            <RecordList
              entries={rows.map((row) => ({
                id: row.id,
                title: row.name,
                status: row.status,
                statusLabel:
                  row.status === 'completed' ? '已完成' : row.enabled ? '待提醒' : '已暂停',
                detail: '',
                meta: compactRecordDate(row.nextAt || row.dueAt),
              }))}
              selection={selection}
              loading={false}
              empty="暂无提醒事项"
            />
          ) : (
            <>
              <table className="task-table storage-table record-table record-table-compact">
                <colgroup>
                  <col className="col-selection" />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <RecordSelectAll selection={selection} />
                    </th>
                    <th>事项名称</th>
                    <th>提醒时间</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <RecordSelect selection={selection} id={row.id} name={row.name} />
                      </td>
                      <td>{row.name}</td>
                      <td>{compactRecordDate(row.nextAt || row.dueAt)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={3}>暂无提醒事项</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </ReactDialog>
  );
}
