import { icon as fileIcon } from './terminal-file-icons.js';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import { ReactDialog } from './ui/react-dialog.js';
import { joinPath, recordPath, isFileContextCurrent } from './terminal-file-model.js';
import { FileToolbar } from './terminal-file-toolbar.js';
import { FileListing } from './terminal-file-listing.js';
import { useFileInteractions } from './terminal-file-interactions.js';
import { FileMenuSurface, FileMenuItem } from './terminal-file-menu-surface.js';
import type {
  FileListing as ListingData,
  FileSort,
  PathHistory,
  PositionedFileContext,
  SessionIdentity,
} from './contracts/terminal.js';
const LIMIT = 256 * 1024 * 1024;
type TransferStatus = '进行中' | '完成' | '已取消' | '失败';
interface Transfer {
  id: number;
  name: string;
  status: TransferStatus;
  error?: string;
  url?: string;
}
type Run = (kind: 'upload' | 'download' | 'install', path: string, file?: File) => Promise<void>;
export function useAdbTransfers(sessionId: string | null, getCsrfToken?: () => string | undefined) {
  const [items, setItems] = useState<Transfer[]>([]),
    running = useRef<AbortController | null>(null),
    serial = useRef(0),
    generation = useRef(0),
    urls = useRef(new Set<string>());
  const latest = useRef({ sessionId, getCsrfToken });
  latest.current = { sessionId, getCsrfToken };
  useEffect(() => {
    generation.current++;
    running.current?.abort();
    running.current = null;
    setItems([]);
    return () => {
      generation.current++;
      running.current?.abort();
      running.current = null;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [sessionId]);
  const run: Run = async (kind, path, file) => {
    const id = latest.current.sessionId;
    if (!id) throw new Error('设备尚未连接');
    if (running.current) throw new Error('请等待当前传输完成，或先取消');
    if (file && file.size > LIMIT) throw new Error('单个文件不能超过 256 MiB');
    const epoch = generation.current,
      controller = new AbortController(),
      key = ++serial.current;
    running.current = controller;
    setItems((rows) => [
      ...rows.slice(-49),
      { id: key, name: file?.name ?? path, status: '进行中' },
    ]);
    try {
      const token = latest.current.getCsrfToken?.();
      const base = '/app/deskicons/api/adb/sessions/' + encodeURIComponent(id);
      const suffix =
        kind === 'install'
          ? '/install'
          : kind === 'upload'
            ? '/files/upload?' + new URLSearchParams({ path })
            : '/files/download?' + new URLSearchParams({ path });
      const response = await fetch(base + suffix, {
        method: kind === 'download' ? 'GET' : 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/octet-stream',
          ...(token ? { 'x-deskicons-token': token } : {}),
        },
        body: kind === 'download' ? undefined : file,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || '传输失败');
      }
      if (kind === 'download') {
        if (Number(response.headers.get('content-length')) > LIMIT) {
          await response.body?.cancel().catch(() => {});
          throw new Error('下载文件不能超过 256 MiB');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('浏览器不支持流式下载');
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > LIMIT) throw new Error('下载文件不能超过 256 MiB');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (epoch !== generation.current || controller.signal.aborted)
          throw new Error('传输已取消');
        for (const previous of urls.current) URL.revokeObjectURL(previous);
        urls.current.clear();
        const url = URL.createObjectURL(new Blob(chunks));
        urls.current.add(url);
        setItems((rows) =>
          rows.map((row) => (row.id === key ? { ...row, url } : { ...row, url: undefined })),
        );
      } else {
        const acknowledged = await response.json().catch((error) => {
          if (controller.signal.aborted) throw error;
          throw new Error('未收到有效的传输完成确认，请刷新后核对结果');
        });
        if (acknowledged?.ok !== true) throw new Error('设备未确认传输完成，请刷新后核对结果');
      }
      if (controller.signal.aborted || epoch !== generation.current) throw new Error('传输已取消');
      if (epoch === generation.current)
        setItems((rows) => rows.map((row) => (row.id === key ? { ...row, status: '完成' } : row)));
    } catch (error) {
      if (epoch === generation.current)
        setItems((rows) =>
          rows.map((row) =>
            row.id === key
              ? {
                  ...row,
                  status: controller.signal.aborted ? '已取消' : '失败',
                  error: controller.signal.aborted ? undefined : errorMessage(error),
                }
              : row,
          ),
        );
      throw controller.signal.aborted ? new Error('传输已取消') : error;
    } finally {
      if (running.current === controller) running.current = null;
    }
  };
  return { items, run, cancel: () => running.current?.abort() };
}
export function AdbTransfers({ items, cancel }: { items: Transfer[]; cancel: () => void }) {
  return (
    <div className="terminal-tree">
      {!items.length && <p className="help">暂无传输。单个文件上限 256 MiB，同一会话依次传输。</p>}
      {items.map((item) => (
        <div key={item.id}>
          <div className="terminal-tree-row">
            <span className="terminal-tree-label" title={item.name}>
              {item.name}
            </span>
            <span>{item.status}</span>
            {item.url && (
              <a href={item.url} download={item.name.split('/').pop() || 'download'}>
                保存文件
              </a>
            )}
            {item.status === '进行中' && (
              <button type="button" onClick={cancel}>
                取消
              </button>
            )}
          </div>
          {item.error && (
            <p className="error" role="alert">
              {item.error}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
function AdbInstall({
  open,
  onClose,
  transfer,
}: {
  open: boolean;
  onClose: () => void;
  transfer: Run;
}) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (open) {
      setFile(null);
      setStatus('');
    }
  }, [open]);
  return (
    <ReactDialog size="small" open={open} title="应用安装" onClose={onClose} busy={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!file || busy) return;
          setBusy(true);
          setStatus('');
          void transfer('install', '', file)
            .then(() => {
              if (mounted.current) onClose();
            })
            .catch((error) => {
              if (mounted.current) setStatus(errorMessage(error));
            })
            .finally(() => {
              if (mounted.current) setBusy(false);
            });
        }}
      >
        <div className="task-form-body">
          <label htmlFor="adb-selected-apk">APK 文件</label>
          <div className="form-input-row">
            <input
              id="adb-selected-apk"
              className="form-input"
              readOnly
              value={file?.name || ''}
              placeholder="未选择本地 APK"
              aria-label="已选择 APK"
            />
            <button type="button" disabled={busy} onClick={() => picker.current?.click()}>
              选择本地文件
            </button>
          </div>
          <input
            ref={picker}
            type="file"
            hidden
            value=""
            accept=".apk,application/vnd.android.package-archive"
            aria-label="选择 APK"
            disabled={busy}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) {
                setFile(selected);
                setStatus('');
              }
            }}
          />
          {status && (
            <p className="form-error" role="alert">
              {status}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={busy || !file}>
            {busy ? '正在安装…' : '安装 APK'}
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}

interface Entry {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'link' | 'other';
  size: number;
  mtime?: number;
}
export function AdbFiles({
  sessionId,
  api,
  toast,
  transfer,
}: {
  sessionId: string;
  api: ApiClient;
  toast: Toast;
  transfer: Run;
}) {
  const [path, setPath] = useState('/sdcard'),
    [draft, setDraft] = useState('/sdcard'),
    [installOpen, setInstallOpen] = useState(false),
    [data, setData] = useState<ListingData | null>(null),
    [sort, setSort] = useState<FileSort>({ key: 'name', desc: false }),
    [history, setHistory] = useState<PathHistory>({ paths: [], index: -1 }),
    [context, setContext] = useState<PositionedFileContext | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; entry: Entry } | null>(null),
    [target, setTarget] = useState(''),
    [dialogError, setDialogError] = useState(''),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    mutating = useRef(false),
    upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const session: SessionIdentity = { id: sessionId, generation: 0, connected: true };
  const current = useRef(session),
    directory = useRef<string | undefined>(),
    seq = useRef(0),
    requestedIndex = useRef<number>();
  current.current = session;
  directory.current = data?.path;
  const interactions = useFileInteractions({
    session,
    data,
    busy: busy || loading,
    context,
    setContext,
    current,
    directory,
    seq,
  });
  async function load(next = path, index?: number) {
    requestedIndex.current = index;
    interactions.clearPress();
    setContext(null);
    setPath(next);
    setRefresh((n) => n + 1);
  }
  const contextAction = (action: (source: PositionedFileContext) => void) => {
    const source = context;
    setContext(null);
    if (source && isFileContextCurrent(source, current.current, directory.current, seq.current))
      action(source);
  };
  const base = '/adb/sessions/' + encodeURIComponent(sessionId) + '/files';
  useEffect(() => {
    let closed = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    setContext(null);
    const index = requestedIndex.current;
    seq.current++;
    void api<{ path: string; items: Entry[] }>(
      base + '?' + new URLSearchParams({ path }),
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!closed) {
          setData({
            path: data.path,
            entries: data.items.map((entry) => ({ ...entry, mtime: entry.mtime ?? Number.NaN })),
            files: data.items.filter((entry) => entry.type !== 'directory').length,
            directories: data.items.filter((entry) => entry.type === 'directory').length,
          });
          setHistory((previous) => recordPath(previous, data.path, index));
          setDraft(data.path);
        }
      })
      .catch((error) => {
        if (!closed) setError(errorMessage(error));
      })
      .finally(() => {
        if (!closed) setLoading(false);
      });
    return () => {
      closed = true;
      controller.abort();
    };
  }, [base, path, refresh, api]);
  const report = (work: Promise<unknown>) =>
    void work.catch((error) => {
      if (mounted.current) toast(errorMessage(error));
    });
  async function mutate() {
    if (!dialog || mutating.current) return;
    const identity = sessionId;
    mutating.current = true;
    setBusy(true);
    setDialogError('');
    try {
      if (dialog.kind === 'delete')
        await api(base + '?' + new URLSearchParams({ path: dialog.entry.path }), 'DELETE');
      else await api(base, 'PUT', { path: dialog.entry.path, target });
      if (mounted.current && current.current.id === identity) {
        setDialog(null);
        setRefresh((n) => n + 1);
      }
    } catch (error) {
      if (mounted.current && current.current.id === identity) setDialogError(errorMessage(error));
    } finally {
      mutating.current = false;
      if (mounted.current && current.current.id === identity) setBusy(false);
    }
  }
  return (
    <>
      <div className="remote-desktop-viewport">
        <FileToolbar
          draft={draft}
          onDraft={setDraft}
          onGo={() => {
            void load(draft);
          }}
          onBack={() => {
            void load(history.paths[history.index - 1], history.index - 1);
          }}
          onForward={() => {
            void load(history.paths[history.index + 1], history.index + 1);
          }}
          onRefresh={() => {
            void load(path, history.index);
          }}
          canBack={history.index > 0}
          canForward={history.index < history.paths.length - 1}
          loading={loading}
          connected
          summary={
            loading
              ? '正在读取…'
              : data
                ? `${data.files} 个文件，${data.directories} 个文件夹`
                : '当前连接的文件'
          }
          pathLabel="Android 文件路径"
          beforeRefresh={
            <button
              type="button"
              className="icon-button"
              aria-label="应用安装"
              title="应用安装"
              onClick={() => setInstallOpen(true)}
            >
              {fileIcon('upload')}
            </button>
          }
        >
          <input
            ref={upload}
            type="file"
            value=""
            hidden
            aria-label="上传 Android 文件"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                const source = {
                  session: { ...current.current },
                  path,
                  sequence: seq.current,
                  entry: null,
                };
                report(
                  transfer('upload', joinPath(path, file.name), file).then(() => {
                    if (
                      mounted.current &&
                      isFileContextCurrent(source, current.current, directory.current, seq.current)
                    )
                      void load(path, history.index);
                  }),
                );
              }
            }}
          />
        </FileToolbar>
        {error && (
          <div className="terminal-files-error" role="alert">
            {error}
          </div>
        )}
        <FileListing
          data={data}
          sizes={{}}
          sort={sort}
          setSort={setSort}
          calculating={null}
          context={context}
          setContext={setContext}
          {...interactions}
          load={load}
          session={session}
          loading={loading}
        />
      </div>
      {context && (
        <FileMenuSurface x={context.x} y={context.y}>
          {context.entry?.type === 'file' && (
            <FileMenuItem
              onClick={() =>
                contextAction((source) =>
                  report(transfer('download', joinPath(source.path, source.entry!.name))),
                )
              }
            >
              下载
            </FileMenuItem>
          )}
          {context.entry && (
            <FileMenuItem
              onClick={() =>
                contextAction((source) => {
                  const entry = {
                    ...source.entry!,
                    path: joinPath(source.path, source.entry!.name),
                  };
                  setDialogError('');
                  setDialog({ kind: 'rename', entry });
                  setTarget(entry.path);
                })
              }
            >
              重命名
            </FileMenuItem>
          )}
          {context.entry && context.entry.type !== 'directory' && (
            <FileMenuItem
              type="danger"
              onClick={() =>
                contextAction((source) => {
                  setDialogError('');
                  setDialog({
                    kind: 'delete',
                    entry: {
                      ...source.entry!,
                      path: joinPath(source.path, source.entry!.name),
                    },
                  });
                })
              }
            >
              删除
            </FileMenuItem>
          )}
          <FileMenuItem onClick={() => contextAction(() => upload.current?.click())}>
            上传文件
          </FileMenuItem>
          <FileMenuItem
            disabled={path === '/'}
            onClick={() =>
              contextAction(() => {
                void load(path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/');
              })
            }
          >
            上级目录
          </FileMenuItem>
        </FileMenuSurface>
      )}
      <AdbInstall open={installOpen} onClose={() => setInstallOpen(false)} transfer={transfer} />
      <ReactDialog
        size="small"
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.kind === 'delete' ? '删除文件' : '重命名文件'}
        busy={busy}
        footer={
          <>
            <button disabled={busy} onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className={dialog?.kind === 'delete' ? 'danger' : 'primary'}
              disabled={busy || (dialog?.kind === 'rename' && !target.trim())}
              type="button"
              onClick={() => void mutate()}
            >
              确认
            </button>
          </>
        }
      >
        <div className="task-form-body">
          {dialog?.kind === 'delete' ? (
            <p>确认删除 {dialog.entry.path}？此操作无法撤销。</p>
          ) : (
            <>
              <label htmlFor="adb-rename-path">新的文件路径</label>
              <input
                id="adb-rename-path"
                className="form-input"
                disabled={busy}
                aria-label="新的 Android 文件路径"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setDialogError('');
                }}
              />
            </>
          )}
          {dialogError && (
            <p className="form-error" role="alert">
              {dialogError}
            </p>
          )}
        </div>
      </ReactDialog>
    </>
  );
}
