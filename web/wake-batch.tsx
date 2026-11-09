import React, { useState, useRef, useEffect } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { NativeSelect } from './native-select.js';
import { confirmAction } from './confirmation.js';
import { errorMessage } from './contracts/shared.js';
import type {
  WakeDevice,
  Connection,
  DeviceResult,
  WakeBatchResult,
  PowerAction,
  PowerConfirmation,
  WakeUiOptions,
} from './contracts/wake.js';
export function createPowerConfirmation(): PowerConfirmation {
  const confirm = confirmAction;
  return (action, targets) => {
    const label = action === 'shutdown' ? '关机' : '重启';
    return confirm({
      title: '确认' + label,
      text: '设备将停止当前运行的任务，SSH 连接也可能断开。请确认以下目标：',
      details: targets
        .map(
          ({ name, connection }) =>
            `${name}\n${connection.username}@${connection.host}:${connection.port}`,
        )
        .join('\n\n'),
      danger: true,
      accept: '确认' + label,
    });
  };
}
export function WakeBatch({
  api,
  toast,
  rows,
  connections,
  onComplete,
  onClose,
}: WakeUiOptions & {
  rows: WakeDevice[];
  connections: Connection[];
  onComplete: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(new Map<string, DeviceResult>()),
    [action, setAction] = useState<'wake' | PowerAction>('wake'),
    [summary, setSummary] = useState(''),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(new Set<string>());
  const alive = useRef(true),
    executing = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const confirm = createPowerConfirmation();
  const limit = () => (action === 'wake' ? 50 : 10);
  const connection = (row: WakeDevice) =>
    connections.find((c) => c.id === row.connectionId && c.kind === 'remote' && c.hasCredentials);
  const eligible = (row: WakeDevice) => action === 'wake' || !!connection(row);
  const close = () => {
    if (!busy) onClose();
  };
  async function execute() {
    if (executing.current || !selected.size) return;
    executing.current = true;
    const op = action,
      targets = rows.filter((row) => selected.has(row.id));
    setBusy(true);

    try {
      const powerTargets = targets.map((row) => ({ row, connection: connection(row) }));
      if (op !== 'wake') {
        const confirmedTargets = powerTargets.flatMap(({ row, connection }) =>
          connection ? [{ name: row.name, connection }] : [],
        );
        if (confirmedTargets.length !== targets.length)
          throw Error('关联的 SSH 连接已不存在，请重新选择设备');
        if (!(await confirm(op, confirmedTargets))) return;
      }
      if (!alive.current) return;
      setError('');
      const response = await api<WakeBatchResult>(
        op === 'wake' ? '/wake/batch' : '/wake/control',
        'POST',
        {
          ids: targets.map((r) => r.id),
          ...(op === 'wake'
            ? {}
            : {
                action: op,
                confirmed: true,
                targets: powerTargets.flatMap(({ row, connection: c }) =>
                  c
                    ? [
                        {
                          id: row.id,
                          connectionId: row.connectionId,
                          system: row.system || 'linux',
                          host: c.host,
                          port: c.port,
                          username: c.username,
                        },
                      ]
                    : [],
                ),
              }),
        },
      );
      if (!alive.current) return;
      setResult(new Map(response.results.map((row) => [row.id, row])));
      setSelected(
        (old) =>
          new Set([...old].filter((id) => !response.results.some((r) => r.id === id && r.success))),
      );
      setSummary(`已提交 ${response.sent} 台，失败 ${response.failed} 台`);
      await onComplete();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      executing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const available = rows.filter(eligible),
    all =
      !!available.length &&
      available.filter((row) => selected.has(row.id)).length ===
        Math.min(available.length, limit()),
    some = available.some((row) => selected.has(row.id)),
    power = action !== 'wake';
  return (
    <ReactDialog
      size="large"
      busy={busy}
      id="wake-batch-dialog"
      className="terminal-dialog storage-batch-dialog content-sized-dialog"
      open
      title="批量管理"
      onClose={close}
    >
      <div className="task-form-body">
        <label id="wake-batch-action-label">处理方式</label>
        <NativeSelect
          aria-labelledby="wake-batch-action-label"
          value={action}
          disabled={busy}
          optionList={[
            { value: 'wake', label: '唤醒设备' },
            { value: 'shutdown', label: '关闭设备' },
            { value: 'reboot', label: '重启设备' },
          ]}
          onChange={(value: unknown) => {
            if (value !== 'wake' && value !== 'shutdown' && value !== 'reboot') return;
            setAction(value);
            setSelected(new Set());
            setResult(new Map());
            setSummary('');
            setError('');
          }}
        />
        <p className="help" id="wake-batch-help">
          {power ? '仅限已关联设备，每批最多 10 台；执行前确认目标。' : '每批最多 50 台。'}
        </p>
        <p className="form-error" id="wake-batch-error" hidden={!error} role="alert">
          {error}
        </p>
        <section className="storage-batch-preview">
          <div className="table-wrap">
            <table className="task-table dialog-table">
              <thead>
                <tr>
                  <th className="col-selection">
                    <input
                      id="wake-batch-all"
                      type="checkbox"
                      aria-label="选择或取消本批设备"
                      checked={all}
                      ref={(el) => {
                        if (el) el.indeterminate = some && !all;
                      }}
                      disabled={busy || !available.length}
                      onChange={(event) => {
                        setSelected(
                          new Set(
                            event.target.checked
                              ? available.slice(0, limit()).map((r) => r.id)
                              : [],
                          ),
                        );
                      }}
                    />
                  </th>
                  <th>设备名称</th>
                  <th>目标设备</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody id="wake-batch-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={4}>暂无设备</td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const c = connection(row),
                      r = result.get(row.id),
                      target = power
                        ? c
                          ? `${c.username}@${c.host}:${c.port}`
                          : '未关联可用 SSH 连接'
                        : row.mac;
                    return (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            data-wake-batch-id={row.id}
                            aria-label={'选择 ' + row.name}
                            checked={selected.has(row.id)}
                            disabled={busy || !eligible(row)}
                            onChange={(event) => {
                              if (event.target.checked && selected.size >= limit()) {
                                toast(`一次最多选择 ${limit()} 台设备`);

                                return;
                              }
                              setSelected((old) => {
                                const next = new Set(old);
                                if (event.target.checked) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td>{row.name}</td>
                        <td className="storage-file-path">{target}</td>
                        <td>{r ? (r.success ? '已提交' : r.error) : '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
        <p className="help" id="wake-batch-summary">
          {summary}
        </p>
      </div>
      <div className="dialog-footer">
        <span id="wake-batch-count">已选择 {selected.size} 台</span>
        <button type="button" data-wake-batch-close disabled={busy} onClick={close}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          id="wake-batch-execute"
          disabled={busy || !selected.size}
          onClick={() => void execute()}
        >
          {busy
            ? '处理中…'
            : { wake: '批量唤醒', shutdown: '批量关机', reboot: '批量重启' }[action]}
        </button>
      </div>
    </ReactDialog>
  );
}
