import React, { useEffect, useRef, useState } from 'react';
import {
  BACKUP_MODULES,
  type BackupModule,
  type BackupKind,
  type BackupPreview,
  type BackupDecision,
  type RestoreResult,
} from '../backend/domain/backup.js';
import { NativeSelect } from './native-select.js';
import { ReactDialog } from './ui/react-dialog.js';
import { TaskPagination } from './task-pagination.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import './config-backup.css';
const modules: Record<BackupModule, string> = {
  icons: '桌面图标',
  tasks: '计划任务',
  ssh: '远程连接与资产目录',
  commands: '快捷指令与常用命令',
  wake: '网络唤醒',
  ai: 'AI 供应商',
  preferences: '使用偏好',
};
const kinds: Record<BackupKind, string> = {
  icons: '桌面图标',
  tasks: '计划任务',
  folders: '目录',
  connections: 'SSH 连接',
  vnc: 'VNC 连接',
  rdp: 'RDP 连接',
  adb: 'ADB 连接',
  shortcuts: '快捷指令',
  commands: '常用命令',
  devices: '网络设备',
  providers: 'AI 供应商',
  preferences: '使用偏好',
};
interface Options {
  api: ApiClient;
  toast: Toast;
  onRestored: () => void | Promise<void>;
}
type Mode = 'export' | 'restore';
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function ConfigBackupDialog({
  api,
  toast,
  onRestored,
  mode,
  onClose,
}: Options & { mode: Mode; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null),
    busyRef = useRef(false),
    alive = useRef(true),
    operation = useRef(''),
    writing = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<BackupModule[]>([...BACKUP_MODULES]),
    [secrets, setSecrets] = useState(false),
    [fileName, setFileName] = useState(''),
    [preview, setPreview] = useState<BackupPreview | null>(null),
    [decisions, setDecisions] = useState<Record<string, BackupDecision>>({}),
    [submitted, setSubmitted] = useState(false),
    [result, setResult] = useState<RestoreResult | null>(null),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10);
  useEffect(() => {
    return () => {
      alive.current = false;
    };
  }, []);
  function close() {
    if (!writing.current) onClose();
  }
  async function request<T = unknown>(route: string, body: unknown): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        api<T>(route, 'POST', body),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('请求超时，请重试；导入会使用同一操作编号避免重复写入')),
            45000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function download() {
    await run(async () => {
      const backup = await request('/backup/export', {
        modules: selected,
        includeCredentials: secrets,
      });
      if (!alive.current) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `NAS管家-配置备份-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('配置备份已生成');
      onClose();
    });
  }
  async function choose(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      setPreview(null);
      setResult(null);
      setDecisions({});
      setSubmitted(false);
      setFileName(file.name);
      setPage(1);
      operation.current = '';
      if (file.size > 32 * 1024 * 1024) throw Error('配置备份不能超过 32 MiB');
      let backup: unknown;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw Error('请选择有效的 JSON 配置备份文件');
      }
      if (!alive.current) return;
      const next = await request<BackupPreview>('/backup/preview', { backup });
      if (!alive.current) return;
      setPreview(next);
      operation.current = requestId();
      setDecisions(
        Object.fromEntries(
          next.rows.map((row) => [row.key, { key: row.key, action: row.defaultAction }]),
        ),
      );
    });
  }
  function change(key: string, patch: Partial<BackupDecision>) {
    setDecisions((old) => ({ ...old, [key]: { ...old[key]!, ...patch } }));
  }
  const issues =
    preview?.rows.flatMap((row) => {
      const decision = decisions[row.key];
      if (!decision || decision.action === 'skip') return [];
      if (decision.action === 'map')
        return decision.targetId ? [] : [`${row.name}：请选择关联的已有配置`];
      return row.dependencies
        .filter((key) => !decisions[key] || decisions[key]?.action === 'skip')
        .map(
          (key) =>
            `${row.name}：需导入或关联 ${preview.rows.find((r) => r.key === key)?.name || key}`,
        );
    }) || [];
  const changes = Object.values(decisions).filter((d) => d.action === 'import').length;
  async function restore() {
    if (!preview || issues.length || !changes) return;
    await run(async () => {
      writing.current = true;
      setSubmitted(true);
      const saved = await request<RestoreResult>('/backup/restore', {
        token: preview.token,
        requestId: operation.current,
        decisions: Object.values(decisions),
      });
      if (!alive.current) return;
      setResult(saved);
      try {
        await onRestored();
      } catch {
        toast('导入已完成，部分界面未刷新，请重新进入对应菜单');
      }
    });
  }
  return (
    <ReactDialog
      size="large"
      open
      onClose={close}
      title={mode === 'export' ? '备份配置' : '恢复配置'}
      busy={busy && submitted}
      className="dialog-scroll-surface"
    >
      <div className="task-form-body">
        {mode === 'export' ? (
          <>
            <div className="config-backup-options">
              {BACKUP_MODULES.map((key) => (
                <label key={key} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked ? [...old, key] : old.filter((item) => item !== key),
                      )
                    }
                  />
                  {modules[key]}
                </label>
              ))}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                aria-label="包含认证凭据"
                checked={secrets}
                disabled={busy}
                onChange={(e) => setSecrets(e.target.checked)}
              />
              包含认证凭据
            </label>
            {secrets && (
              <p className="notice">备份将包含明文 SSH 密码、私钥及 API Key，请妥善保管。</p>
            )}
            <details className="help-details">
              <summary>备份范围</summary>
              <p>自动包含任务关联的设备与连接；不含聊天、附件、技能、扫描结果及文件。</p>
              <p>脚本中的敏感内容仍会保留。</p>
            </details>
          </>
        ) : result ? (
          <div role="status">
            <h3>导入完成</h3>
            <p>
              已导入 {result.imported} 项，跳过 {result.skipped} 项，关联已有配置 {result.mapped}{' '}
              项。
            </p>
            <p className="help">导入任务默认暂停；电源目标需确认，桌面图标需重新添加。</p>
          </div>
        ) : (
          <>
            <div className="toolbar-actions">
              <button type="button" disabled={busy} onClick={() => input.current?.click()}>
                {preview ? '重新选择' : '选择备份文件'}
              </button>
              <span className="help">{fileName || 'JSON 配置备份'}</span>
            </div>
            <input
              ref={input}
              type="file"
              hidden
              accept=".json,application/json"
              aria-label="选择配置备份"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void choose(file);
              }}
            />
            {!preview && <p className="help">预览后合并，已有配置保留。</p>}
            {preview && (
              <>
                <p className="help">同名配置默认跳过，可另存副本；依赖项可导入或关联。</p>
                {preview.warnings.map((warning, i) => (
                  <p className="notice" key={i}>
                    {warning}
                  </p>
                ))}
                <div className="table-wrap">
                  <table className="task-table config-backup-table">
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>名称</th>
                        <th>处理方式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice((page - 1) * pageSize, page * pageSize).map((row) => {
                        const decision = decisions[row.key]!;
                        return (
                          <tr key={row.key}>
                            <td>{kinds[row.kind]}</td>
                            <td>
                              <span>{row.name}</span>
                              {row.conflict && <span className="help"> · 已存在</span>}
                              {row.warnings.map((text, i) => (
                                <p className="help" key={i}>
                                  {text}
                                </p>
                              ))}
                              {decision.action === 'import' &&
                                !['preferences', 'commands'].includes(row.kind) && (
                                  <input
                                    aria-label={'导入名称 ' + row.name}
                                    value={decision.name ?? row.name}
                                    disabled={busy || submitted}
                                    onChange={(e) => change(row.key, { name: e.target.value })}
                                  />
                                )}
                            </td>
                            <td>
                              <NativeSelect
                                aria-label={'处理 ' + row.name}
                                value={decision.action}
                                disabled={busy || submitted}
                                optionList={[
                                  { value: 'skip', label: '跳过' },
                                  {
                                    value: 'import',
                                    label:
                                      row.kind === 'preferences'
                                        ? '应用偏好'
                                        : row.conflict
                                          ? '导入副本'
                                          : '导入',
                                  },
                                  ...(row.candidates.length
                                    ? [{ value: 'map', label: '关联已有' }]
                                    : []),
                                ]}
                                onChange={(action) => {
                                  if (action === 'skip' || action === 'import' || action === 'map')
                                    change(row.key, { action, targetId: undefined });
                                }}
                              />
                              {decision.action === 'map' && (
                                <NativeSelect
                                  aria-label={'关联 ' + row.name}
                                  placeholder="选择已有配置"
                                  value={decision.targetId || ''}
                                  disabled={busy || submitted}
                                  optionList={row.candidates.map((item) => ({
                                    value: item.id,
                                    label: item.name,
                                  }))}
                                  onChange={(targetId) => change(row.key, { targetId })}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="task-pagination native-pagination" aria-label="配置预览分页">
                  <TaskPagination
                    total={preview.rows.length}
                    page={page}
                    pageSize={pageSize}
                    onChange={(next, size) => {
                      setPage(next);
                      setPageSize(size);
                    }}
                  />
                </div>
                {!!issues.length && (
                  <p className="form-error" role="alert">
                    {issues.slice(0, 3).join('；')}
                    {issues.length > 3 ? '；还有其他依赖未处理' : ''}
                  </p>
                )}
              </>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="help" role="status">
            {mode === 'export' ? '正在生成备份…' : submitted ? '正在导入配置…' : '正在检查备份…'}
          </p>
        )}
      </div>
      <div className="dialog-footer">
        <button type="button" disabled={busy && submitted} onClick={close}>
          {result ? '完成' : '取消'}
        </button>
        {!result && (
          <button
            type="button"
            className="primary"
            disabled={
              busy ||
              (mode === 'export' ? !selected.length : !preview || !changes || !!issues.length)
            }
            onClick={() => void (mode === 'export' ? download() : restore())}
          >
            {mode === 'export' ? '下载备份' : submitted ? '重试导入' : '确认导入'}
          </button>
        )}
      </div>
    </ReactDialog>
  );
}
