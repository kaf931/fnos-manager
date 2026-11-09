import { AutoScrollName } from './auto-scroll-name.js';
import React, { useEffect, useRef, useState } from 'react';
import { StorageToolbar } from './storage-toolbar.js';
import { AppIcon } from './ui/icon-markup.js';
import {
  cleanupLabels,
  type CleanupKind,
  type CleanupSummary,
  type HistoryLimits,
} from '../backend/domain/maintenance.js';
import { confirmAction } from './confirmation.js';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
export const cleanupRecordModes = {
  scans: 'scan-history',
  renames: 'rename-history',
  operations: 'operations',
  deliveries: 'deliveries',
  taskRuns: 'task-runs',
  restoreReceipts: 'restore-receipts',
  serviceLog: 'service-log',
  aiHistory: 'ai-chats',
  attachments: 'attachments',
  updateCache: 'update-cache',
} as const;
export type CleanupRecordMode = (typeof cleanupRecordModes)[keyof typeof cleanupRecordModes];
export const cleanupLimitText = (kind: CleanupKind, limits: HistoryLimits) =>
  kind === 'serviceLog'
    ? limits.serviceLogMiB + ' MiB / 份'
    : kind === 'aiHistory'
      ? '50 个会话'
      : kind === 'attachments' || kind === 'updateCache'
        ? '按需清理'
        : limits[kind] + ' 条';
export function CleanupTable({
  data,
  selected,
  onSelect,
  onOpen,
  mobile = false,
}: {
  data: CleanupSummary;
  selected: CleanupKind[];
  onSelect: (kinds: CleanupKind[]) => void;
  onOpen?: (mode: CleanupRecordMode) => void;
  mobile?: boolean;
}) {
  const eligible = data.items
    .filter((item) => item.count > item.protected)
    .map((item) => item.kind);
  const category = (kind: CleanupKind) => {
    const mode = cleanupRecordModes[kind];
    return mode && onOpen ? (
      <button
        type="button"
        className="text-button"
        aria-label={'查看' + cleanupLabels[kind]}
        onClick={() => onOpen(mode)}
      >
        {cleanupLabels[kind]}
      </button>
    ) : (
      cleanupLabels[kind]
    );
  };
  if (mobile)
    return (
      <div className="storage-history-list history-mobile-list history-compact-list">
        <label className="history-compact-row history-compact-select-all">
          <input
            type="checkbox"
            aria-label="选择全部可清理记录"
            checked={eligible.length > 0 && eligible.every((k) => selected.includes(k))}
            disabled={!eligible.length}
            onChange={(e) => onSelect(e.target.checked ? eligible : [])}
          />
          <span className="muted">全选</span>
        </label>
        {data.items.map((item) => (
          <div className="history-compact-row" key={item.kind}>
            <input
              type="checkbox"
              aria-label={'选择' + cleanupLabels[item.kind]}
              disabled={item.count <= item.protected}
              checked={selected.includes(item.kind)}
              onChange={(e) =>
                onSelect(
                  e.target.checked
                    ? [...selected, item.kind]
                    : selected.filter((k) => k !== item.kind),
                )
              }
            />
            <AutoScrollName>{category(item.kind)}</AutoScrollName>
            <span className="history-compact-count">{item.count}</span>
            <span className="history-compact-meta muted">
              {item.kind === 'serviceLog' ||
              item.kind === 'attachments' ||
              item.kind === 'updateCache'
                ? (item.bytes ?? 0) / 1024 / 1024 < 0.01
                  ? '< 0.01 MiB'
                  : ((item.bytes ?? 0) / 1024 / 1024).toFixed(2) + ' MiB'
                : '保留 ' + cleanupLimitText(item.kind, data.limits)}
              {item.protected > 0 ? ' · ' + item.protected + ' 条受保护' : ''}
            </span>
          </div>
        ))}
      </div>
    );
  return (
    <div className="table-wrap storage-history-list">
      <table className="task-table storage-table record-table">
        <colgroup>
          <col className="col-selection" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="col-selection">
              <input
                type="checkbox"
                aria-label="选择全部可清理记录"
                checked={eligible.length > 0 && eligible.every((k) => selected.includes(k))}
                disabled={!eligible.length}
                onChange={(e) => onSelect(e.target.checked ? eligible : [])}
              />
            </th>
            <th>类别</th>
            <th>数量</th>
            <th>保留上限</th>
            <th>大小</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.kind}>
              <td className="col-selection">
                <input
                  type="checkbox"
                  aria-label={'选择' + cleanupLabels[item.kind]}
                  disabled={item.count <= item.protected}
                  checked={selected.includes(item.kind)}
                  onChange={(e) =>
                    onSelect(
                      e.target.checked
                        ? [...selected, item.kind]
                        : selected.filter((k) => k !== item.kind),
                    )
                  }
                />
              </td>
              <td>
                {category(item.kind)}
                {item.protected > 0 && <span className="muted">（{item.protected} 条受保护）</span>}
              </td>
              <td>{item.count}</td>
              <td>{cleanupLimitText(item.kind, data.limits)}</td>
              <td>{item.bytes === null ? '—' : (item.bytes / 1024 / 1024).toFixed(2) + ' MiB'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function StorageCleanup({
  api,
  toast,
  onOpen,
  active,
  revision = 0,
}: {
  api: ApiClient;
  toast: Toast;
  onOpen: (mode: CleanupRecordMode) => void;
  active: boolean;
  revision?: number;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    ++lifecycle.current;
    if (!active) setSettingsOpen(false);
    return () => {
      ++lifecycle.current;
    };
  }, [active]);
  const alive = useRef(active);
  alive.current = active;
  useEffect(() => {
    alive.current = active;
    return () => {
      alive.current = false;
    };
  }, []);
  const [data, setData] = useState<CleanupSummary | null>(null),
    [selected, setSelected] = useState<CleanupKind[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:620px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width:620px)'),
      change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const read = async () => {
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    if (!active) return;
    let live = true;
    setError('');
    setData(null);
    setSelected([]);
    api<CleanupSummary>('/storage/cleanup')
      .then((value) => {
        if (live) setData(value);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [version, revision, active, api]);
  const choose = setSelected;
  const manage = async () => {
    if (busy || !selected.length) return;
    const kinds = [...selected],
      ticket = lifecycle.current;
    await confirmAction({
      title: '清理应用记录',
      text: '清理所选记录、附件及更新缓存，不影响 NAS 源文件或应用配置。删除对话会清理附件，删除改名记录后无法撤销；清理更新缓存会移除断点及回滚备份。进行中的任务及保护期内记录会保留。',
      accept: '清理',
      danger: true,
      onAccept: async () => {
        if (!alive.current || ticket !== lifecycle.current) return;
        setBusy(true);
        try {
          const result = await api<{ cleanupPending?: boolean }>('/storage/cleanup', 'POST', {
            kinds,
            confirmed: true,
          });
          if (!alive.current || ticket !== lifecycle.current) return;
          toast(result.cleanupPending ? '记录已清理，部分附件文件将在后续重试' : '清理完成');
          await read();
        } finally {
          setBusy(false);
        }
      },
    });
  };
  return (
    <section
      className="storage-history-inline record-content"
      aria-label="应用清理列表"
      aria-busy={busy}
    >
      <StorageToolbar>
        <button
          aria-label="清理所选"
          title="清理所选"
          className="toolbar-manage"
          disabled={busy || !selected.length}
          onClick={() => void manage().catch((e) => toast(errorMessage(e)))}
        >
          <AppIcon name="trash" />
          <span className="toolbar-action-label">清理所选</span>
        </button>
        <button
          id="storage-cleanup-configure"
          className="toolbar-manage"
          aria-label="配置保留上限"
          onClick={() => setSettingsOpen(true)}
        >
          <AppIcon name="settings" />
          <span className="toolbar-action-label">保留上限</span>
        </button>
      </StorageToolbar>
      {settingsOpen && (
        <HistoryLimitsDialog
          api={api}
          toast={toast}
          onSaved={() => void read()}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : data ? (
        <CleanupTable
          data={data}
          selected={selected}
          onSelect={choose}
          onOpen={onOpen}
          mobile={mobile}
        />
      ) : null}
    </section>
  );
}
type LimitsOptions = { api: ApiClient; toast: Toast; onSaved: () => void; onClose: () => void };
export function HistoryLimitsDialog({ api, toast, onSaved, onClose }: LimitsOptions) {
  const alive = useRef(true),
    busyRef = useRef(false);
  const [values, setValues] = useState<HistoryLimits | null>(null),
    [saved, setSaved] = useState<HistoryLimits | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    api<HistoryLimits>('/storage/cleanup/settings')
      .then((v) => {
        if (alive.current) {
          setValues(v);
          setSaved(v);
        }
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      });
    return () => {
      alive.current = false;
    };
  }, [api]);
  const invalid =
    !values ||
    Object.entries(values).some(
      ([key, n]) => !Number.isInteger(n) || n < 1 || n > (key === 'serviceLogMiB' ? 100 : 10000),
    );
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const close = () => {
    if (!busyRef.current) onClose();
  };
  async function save() {
    if (!values || invalid || !dirty || busyRef.current) return;
    const input = { ...values };
    const apply = async () => {
      if (!alive.current || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        const next = await api<HistoryLimits>('/storage/cleanup/settings', 'PUT', input);
        if (alive.current) {
          setValues(next);
          setSaved(next);
          toast('保留上限已保存');
          onSaved();
          onClose();
        }
      } catch (e) {
        if (alive.current) setError(errorMessage(e));
        throw e;
      } finally {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    };
    if (saved && Object.entries(input).some(([key, n]) => n < saved[key as keyof HistoryLimits]))
      await confirmAction({
        title: '降低保留上限',
        text: '超额历史记录会自动清理，改名记录清理后无法用于撤销。正在处理和最近 7 天的恢复回执会保留。',
        accept: '保存',
        onAccept: apply,
      });
    else await apply();
  }
  return (
    <ReactDialog busy={busy} open onClose={close} title="保留上限">
      <div className="task-form-body">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {values ? (
          <div className="form-grid">
            {Object.entries(values).map(([name, value]) => {
              const key = name as keyof HistoryLimits;
              return (
                <label key={key} htmlFor={'history-limit-' + key}>
                  {key === 'serviceLogMiB' ? '服务日志（MiB / 份）' : cleanupLabels[key] + '（条）'}
                  <input
                    id={'history-limit-' + key}
                    type="number"
                    min="1"
                    max={key === 'serviceLogMiB' ? 100 : 10000}
                    step="1"
                    value={Number.isNaN(value) ? '' : value}
                    disabled={busy}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [key]: e.target.value === '' ? NaN : Number(e.target.value),
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        ) : (
          !error && (
            <p className="notice" role="status">
              正在读取保留设置…
            </p>
          )
        )}
      </div>
      <div className="dialog-footer">
        <button type="button" onClick={close} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || invalid || !dirty}
          onClick={() => {
            void save().catch((e) => toast(errorMessage(e)));
          }}
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </ReactDialog>
  );
}
