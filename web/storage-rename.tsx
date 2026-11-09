import { AutoScrollName } from './auto-scroll-name.js';
import React from 'react';
import { confirmAction } from './confirmation.js';
import { TaskPagination } from './task-pagination.js';
import { ReactDialog } from './ui/react-dialog.js';
import { formatSize } from './terminal-file-model.js';
import { AppIcon } from './ui/icon-markup.js';
import { StorageToolbar } from './storage-toolbar.js';
import { RENAME_SELECTION_LIMIT } from './storage-scan-model.js';
import { errorMessage } from './contracts/shared.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import type {
  RenameFile,
  RenameListing,
  RenamePreview,
  RenameRecord,
  RenameRules,
} from './contracts/storage.js';
interface Options {
  api: ApiClient;
  toast: Toast;
  path: string;
  active: boolean;
  revision?: number;
  initialRecord?: RenameRecord | null;
  onChoose: () => void;
  onPath: (path: string) => void;
}
export function StorageRename({
  api,
  toast,
  path,
  active,
  revision = 0,
  initialRecord,
  onChoose,
  onPath,
}: Options) {
  const [navigation, setNavigation] = React.useState({ paths: path ? [path] : [], index: 0 });
  const [navigationLoading, setNavigationLoading] = React.useState(false);
  const [rows, setRows] = React.useState<RenameFile[]>([]);
  const [preview, setPreview] = React.useState<RenamePreview | null>(null);
  const [record, setRecord] = React.useState<RenameRecord | null>(initialRecord || null);
  const [selected, setSelected] = React.useState(new Set<string>());
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false),
    epoch = React.useRef(0),
    dialogEpoch = React.useRef(0),
    mounted = React.useRef(true),
    alive = React.useRef(active);
  alive.current = active;
  const [page, setPage] = React.useState(1),
    [size, setSize] = React.useState(10);
  const [message, setMessage] = React.useState(''),
    [error, setError] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [mobile, setMobile] = React.useState(() => matchMedia('(max-width:620px)').matches);
  const [rules, setRules] = React.useState<RenameRules>({
    mode: 'unified',
    baseName: '',
    find: '',
    replace: '',
    prefix: '',
    suffix: '',
    start: 1,
    pad: 3,
    number: false,
    keepExtension: true,
  });
  React.useEffect(() => {
    const media = matchMedia('(max-width:620px)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  React.useEffect(() => {
    setNavigationLoading(false);
    if (!active) {
      setDialogOpen(false);
      ++dialogEpoch.current;
      return;
    }
    if (initialRecord) {
      setRecord(initialRecord);
      setRows([]);
    } else void load().catch((e) => toast(errorMessage(e)));
    return () => {
      ++epoch.current;
      ++dialogEpoch.current;
    };
  }, [path, active, revision, initialRecord]);
  React.useEffect(() => {
    mounted.current = true;
    alive.current = active;
    return () => {
      mounted.current = false;
      alive.current = false;
      ++epoch.current;
      ++dialogEpoch.current;
    };
  }, []);
  function closeDialog() {
    if (!busyRef.current) {
      setDialogOpen(false);
      setPreview(null);
      ++dialogEpoch.current;
    }
  }
  function updateRule<K extends keyof RenameRules>(key: K, value: RenameRules[K]) {
    setRules((old) => ({ ...old, [key]: value }));
    setPreview(null);
    setError('');
  }
  function renderPreview() {
    return (
      <ReactDialog
        size="large"
        open={dialogOpen}
        busy={busy}
        onClose={closeDialog}
        title="批量管理"
        className="storage-batch-dialog"
      >
        <div className="task-form-body">
          <fieldset className="terminal-choice-field" disabled={busy}>
            <legend>改名方式</legend>
            <div className="terminal-choice">
              {(
                [
                  ['unified', '统一命名'],
                  ['rules', '规则改名'],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="rename-method"
                    value={value}
                    checked={rules.mode === value}
                    onChange={() => updateRule('mode', value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div data-unified hidden={rules.mode !== 'unified'}>
            <label>
              基础名称
              <input
                name="baseName"
                maxLength={120}
                placeholder="例如：照片"
                value={rules.baseName || ''}
                disabled={busy}
                onChange={(e) => updateRule('baseName', e.currentTarget.value)}
              />
            </label>
            <p className="help">示例：照片_001.jpg</p>
          </div>
          <div data-rule-fields hidden={rules.mode !== 'rules'}>
            <div className="form-grid">
              {(
                [
                  ['find', '查找文字'],
                  ['replace', '替换为'],
                  ['prefix', '名称前缀'],
                  ['suffix', '名称后缀'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    maxLength={120}
                    value={rules[key] || ''}
                    disabled={busy}
                    onChange={(e) => updateRule(key, e.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
            <div className="form-check-row">
              <label className="checkbox-label">
                <input
                  name="number"
                  type="checkbox"
                  checked={rules.number}
                  disabled={busy}
                  onChange={(e) => updateRule('number', e.currentTarget.checked)}
                />
                添加序号
              </label>
            </div>
          </div>
          <div className="form-grid">
            <label>
              序号起始值
              <input
                name="start"
                type="number"
                min={0}
                max={999999}
                value={rules.start}
                disabled={busy}
                onChange={(e) => updateRule('start', Number(e.currentTarget.value))}
              />
            </label>
            <label>
              序号位数
              <input
                name="pad"
                type="number"
                min={1}
                max={6}
                value={rules.pad}
                disabled={busy}
                onChange={(e) => updateRule('pad', Number(e.currentTarget.value))}
              />
            </label>
          </div>
          <div className="form-check-row">
            <label className="checkbox-label">
              <input
                name="keepExtension"
                type="checkbox"
                checked={rules.keepExtension}
                disabled={busy}
                onChange={(e) => updateRule('keepExtension', e.currentTarget.checked)}
              />
              保留扩展名
            </label>
          </div>
          <p className="form-error" data-error hidden={!error} role="alert">
            {error}
          </p>
          <section className="storage-batch-preview" aria-label="改名预览">
            <p className="help" data-preview-summary>
              {preview
                ? `${preview.changed} 个改名，${preview.conflicts} 个冲突`
                : '生成预览后确认改名。'}
            </p>
            <div className="table-wrap">
              <table className="task-table dialog-table">
                <thead>
                  <tr>
                    <th>原名称</th>
                    <th>新名称</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody data-preview-rows>
                  {preview?.entries.map((e) => (
                    <tr key={e.from}>
                      <td>{e.from}</td>
                      <td>{e.to}</td>
                      <td className={e.error ? 'form-error' : ''}>
                        {e.error || (e.unchanged ? '不变' : '待改名')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="dialog-footer">
          <button data-close disabled={busy} onClick={closeDialog}>
            取消
          </button>
          <button
            data-preview
            disabled={busy || !selected.size}
            onClick={() =>
              void guarded(async () => {
                const ticket = dialogEpoch.current;
                const result = await api<RenamePreview>('/storage/rename/previews', 'POST', {
                  path,
                  names: [...selected].sort(),
                  rules,
                });
                if (ticket !== dialogEpoch.current || !alive.current) return;
                setPreview(result);
                setError('');
              })
            }
          >
            生成预览
          </button>
          <button
            className="primary"
            data-execute
            disabled={busy || !preview || !!preview.conflicts || !preview.changed}
            onClick={() => {
              const current = preview;
              if (!current || current.conflicts || !current.changed) return;
              const ticket = epoch.current;
              void guarded(async () => {
                const nextRecord = await api<RenameRecord>(
                  '/storage/rename/previews/' + current.id + '/execute',
                  'POST',
                  { confirmed: true },
                );
                if (!alive.current || ticket !== epoch.current) return;
                setPreview(null);
                setSelected(new Set());
                setRecord(nextRecord);
                setMessage(nextRecord.error || '改名完成，可在改名记录中查看或撤销。');
                setDialogOpen(false);
              });
            }}
          >
            确认改名
          </button>
        </div>
      </ReactDialog>
    );
  }
  type DisplayFile = {
    name: string;
    type: 'file' | 'directory';
    size: number;
    to?: string;
    applied?: boolean;
    error?: string | null;
  };
  function displayRows(): DisplayFile[] {
    return record
      ? record.entries.map((e) => ({
          name: e.from,
          type: 'file',
          size: 0,
          to: e.to,
          applied: e.applied,
        }))
      : rows;
  }
  function state(r: DisplayFile) {
    return r.type === 'directory'
      ? '文件夹'
      : r.error || (record ? (r.applied ? '已完成' : '未改名') : formatSize(r.size));
  }
  function toggle(name: string, checked: boolean) {
    setSelected((old) => {
      const next = new Set(old);
      if (checked && !next.has(name) && next.size >= RENAME_SELECTION_LIMIT) {
        toast(`一次最多选择 ${RENAME_SELECTION_LIMIT} 个文件`);
        return old;
      }
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
    setPreview(null);
  }
  function render() {
    const data = displayRows(),
      total = data.length;
    const shown = mobile ? data : data.slice((page - 1) * size, page * size),
      files = shown.filter((r) => r.type !== 'directory');
    const fileName = (r: DisplayFile) =>
      r.type === 'directory' ? (
        <button
          className="text-button"
          data-directory={r.name}
          onClick={() => void navigate(path.replace(/\/$/, '') + '/' + r.name)}
        >
          ▸ {r.name}
        </button>
      ) : (
        r.name
      );
    const checkbox = (r: DisplayFile) =>
      !record && r.type !== 'directory' ? (
        <input
          type="checkbox"
          data-name={r.name}
          aria-label={'选择 ' + r.name}
          checked={selected.has(r.name)}
          disabled={busy}
          onChange={(e) => toggle(r.name, e.currentTarget.checked)}
        />
      ) : null;
    return (
      <>
        <StorageToolbar>
          <button
            className="icon-button"
            data-back
            aria-label="后退"
            title="后退"
            disabled={busy || navigationLoading || !!record || navigation.index < 1}
            onClick={() =>
              void navigate(navigation.paths[navigation.index - 1], navigation.index - 1)
            }
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M15 5 6 12l9 7z" />
            </svg>
          </button>
          <button
            className="icon-button"
            data-forward
            aria-label="前进"
            title="前进"
            disabled={
              busy ||
              navigationLoading ||
              !!record ||
              navigation.index >= navigation.paths.length - 1
            }
            onClick={() =>
              void navigate(navigation.paths[navigation.index + 1], navigation.index + 1)
            }
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M9 5l9 7-9 7z" />
            </svg>
          </button>
          <button
            className="toolbar-manage"
            title={path ? '更换目录' : '选择目录'}
            aria-label="选择整理目录"
            disabled={busy || navigationLoading || !!record}
            onClick={onChoose}
          >
            <AppIcon name="folder" />
            <span className="toolbar-action-label">{path ? '更换目录' : '选择目录'}</span>
          </button>
          <button
            aria-label="批量管理"
            title="批量管理"
            className="toolbar-manage"
            disabled={busy || !selected.size || !!record}
            onClick={() => {
              setPreview(null);
              setError('');
              ++dialogEpoch.current;
              setDialogOpen(true);
            }}
          >
            <AppIcon name="grid" />
            <span className="toolbar-action-label">批量管理</span>
          </button>
          <button
            data-undo
            hidden={
              !record ||
              record.operation !== 'rename' ||
              !!record.undoneBy ||
              (!record.changed && record.status !== 'interrupted')
            }
            disabled={busy}
            onClick={() => void undo()}
          >
            {record?.status === 'interrupted' ? '检查并撤销' : '撤销改名'}
          </button>
        </StorageToolbar>
        <p className="notice" data-message hidden={!message}>
          {message}
        </p>
        <div className="table-wrap storage-rename-list" hidden={mobile}>
          <table className="task-table storage-table">
            <thead>
              <tr>
                <th className="col-selection">
                  <input
                    type="checkbox"
                    data-all
                    aria-label="选择当前页文件"
                    disabled={busy || !!record || !files.length}
                    checked={!!files.length && files.every((r) => selected.has(r.name))}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setSelected((old) => {
                        const next = new Set(old);
                        for (const r of files) {
                          if (checked && next.size < RENAME_SELECTION_LIMIT) next.add(r.name);
                          else if (!checked) next.delete(r.name);
                        }
                        return next;
                      });
                      setPreview(null);
                    }}
                  />
                </th>
                <th>文件名称</th>
                <th>新名称</th>
                <th>状态 / 大小</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((r) => (
                  <tr
                    key={r.name}
                    onDoubleClick={(e) => {
                      if (e.target instanceof Element && e.target.closest('button,input')) return;
                      if (r.type === 'directory')
                        void navigate(path.replace(/\/$/, '') + '/' + r.name);
                    }}
                  >
                    <td className="col-selection">{checkbox(r)}</td>
                    <td title={r.name}>{fileName(r)}</td>
                    <td>{r.to || '—'}</td>
                    <td>{state(r)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>{path ? '此目录为空' : '请选择目录'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="storage-rename-mobile history-compact-list" hidden={!mobile}>
          {mobile &&
            (shown.length ? (
              shown.map((r) => (
                <article className="history-compact-row" key={r.name}>
                  {checkbox(r)}
                  <AutoScrollName title={r.to ? r.name + ' → ' + r.to : r.name}>
                    {fileName(r)}
                    {r.to && <> → {r.to}</>}
                  </AutoScrollName>
                  <span className="history-compact-meta muted" title={state(r)}>
                    {state(r)}
                  </span>
                </article>
              ))
            ) : (
              <p className="help">{path ? '此目录为空' : '请选择目录'}</p>
            ))}
        </div>
        <div
          className="task-pagination native-pagination"
          aria-label="文件整理分页"
          data-pagination
          hidden={mobile}
        >
          <TaskPagination
            page={page}
            pageSize={size}
            total={total}
            onChange={(p: number, n: number) => {
              setPage(n !== size ? 1 : p);
              setSize(n);
            }}
          />
        </div>
      </>
    );
  }
  async function guarded(fn: () => Promise<void>) {
    if (busyRef.current || !alive.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (alive.current) {
        setError(errorMessage(e));
        toast(errorMessage(e));
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function load() {
    const ticket = ++epoch.current;
    if (!path) {
      setRows([]);
      return;
    }
    const result = await api<RenameListing>(
      '/storage/rename/files?path=' + encodeURIComponent(path),
    );
    if (ticket !== epoch.current || !alive.current) return;
    setRows(result.items);
    setSelected(new Set());
    setPreview(null);
    setRecord(null);
    setPage(1);
    setNavigation((old) => (old.paths.includes(path) ? old : { paths: [path], index: 0 }));
    setMessage(result.truncated ? '目录条目过多，仅显示部分文件，请选择更小的目录。' : '');
  }
  async function navigate(next: string | undefined, index: number | null = null) {
    if (busyRef.current || navigationLoading || !next) return;
    const base = navigation.paths[0];
    if (!base || (next !== base && !next.startsWith(base.replace(/\/$/, '') + '/'))) return;
    setNavigationLoading(true);
    const ticket = ++epoch.current;
    try {
      await api<RenameListing>('/storage/rename/files?path=' + encodeURIComponent(next));
      if (ticket !== epoch.current || !alive.current) return;
      setNavigation((old) =>
        index === null
          ? { paths: [...old.paths.slice(0, old.index + 1), next], index: old.index + 1 }
          : { ...old, index },
      );
      onPath(next);
    } catch (e) {
      if (alive.current) toast(errorMessage(e));
    } finally {
      if (alive.current && ticket === epoch.current) setNavigationLoading(false);
    }
  }
  async function undo() {
    const current = record,
      ticket = epoch.current;
    if (
      !current ||
      !(await confirmAction({
        title: '撤销改名',
        text: '确认撤销此批次改名？执行前会重新校验文件和原名称。',
        accept: '撤销改名',
      })) ||
      !alive.current ||
      ticket !== epoch.current
    )
      return;
    await guarded(async () => {
      const next = await api<RenameRecord>(
        '/storage/rename/records/' + current.id + '/undo',
        'POST',
        { confirmed: true },
      );
      if (alive.current && ticket === epoch.current) {
        setRecord(next);
        setMessage(next.error || '撤销完成。');
      }
    });
  }
  return (
    <section id="storage-organize">
      {render()}
      {dialogOpen && renderPreview()}
    </section>
  );
}
