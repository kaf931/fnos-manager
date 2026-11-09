import { FileToolbar } from './terminal-file-toolbar.js';
import {
  errorMessage,
  type ApiClient,
  type Toast,
  type ConfirmAction,
} from './contracts/shared.js';
import type {
  SessionIdentity,
  FileListing as ListingData,
  UploadProgress,
  FileSort,
  PathHistory,
  PositionedFileContext,
  FileContext,
  DirectorySize,
} from './contracts/terminal.js';
interface FileDirectoryRequest {
  key: string;
  session: SessionIdentity;
  path?: string;
  historyIndex?: number;
  fresh: boolean;
}
import React, { useState, useRef, useEffect } from 'react';
import { createFileApi } from './terminal-file-api.js';
import { createDirectoryLoader } from './terminal-directory-loader.js';
import { isCurrentResponse, recordPath } from './terminal-file-model.js';
import { icon } from './terminal-file-icons.js';
import { useFileInteractions } from './terminal-file-interactions.js';
import { useFilePanelResize } from './terminal-file-resize.js';
import { createFileOperations } from './terminal-file-operations.js';
import { createFileUploadHandlers } from './terminal-file-uploads.js';
import { FileListing } from './terminal-file-listing.js';
import { FileContextMenu } from './terminal-file-menu.js';
const h = React.createElement;
export function TerminalFiles({
  api,
  toast,
  confirm,
  session,
  getCsrfToken,
  workspaceRef,
  panelId,
}: {
  api: ApiClient;
  toast: Toast;
  confirm: ConfirmAction;
  session: SessionIdentity;
  getCsrfToken: () => string | undefined;
  workspaceRef: React.RefObject<HTMLDivElement>;
  panelId: string;
}) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const fileApi = React.useMemo(
    () => createFileApi({ api, getSession: () => sessionRef.current, getCsrfToken }),
    [api, getCsrfToken],
  );
  const [open, setOpen] = useState(false),
    [data, setData] = useState<ListingData | null>(null),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<UploadProgress | null>(null),
    [operationStatus, setOperationStatus] = useState(''),
    [sort, setSort] = useState<FileSort>({ key: 'name', desc: false }),
    [history, setHistory] = useState<PathHistory>({ paths: [], index: -1 }),
    [context, setContext] = useState<PositionedFileContext | null>(null),
    [sizes, setSizes] = useState<Record<string, DirectorySize>>({}),
    [calculating, setCalculating] = useState<string | null>(null);
  const taskEpoch = useRef(0),
    directoryLoader = useRef<ReturnType<
      typeof createDirectoryLoader<FileDirectoryRequest, ListingData>
    > | null>(null),
    pendingUpload = useRef<FileContext | null>(null),
    directory = useRef<string | undefined>(undefined),
    seq = useRef(0),
    upload = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    current = useRef(session);
  current.current = session;
  directory.current = data?.path;
  const valid = (s: SessionIdentity) => isCurrentResponse(s, current.current);
  const { press, longPress, lastPointer, clearPress, showContext, touchStart } =
    useFileInteractions({ session, data, busy, context, setContext, current, directory, seq });
  const { panelStyle, resizerProps } = useFilePanelResize({
    workspaceRef,
    clearPress,
    setContext,
    setOpen,
  });

  if (!directoryLoader.current)
    directoryLoader.current = createDirectoryLoader<FileDirectoryRequest, ListingData>({
      request: (job) => fileApi.list(job.session, job.path),
      onStart: (job) => {
        clearPress();
        setContext(null);
        job.sequence = ++seq.current;
        setLoading(true);
        setError('');
      },
      onSuccess: (next, job) => {
        if (valid(job.session) && job.sequence === seq.current) {
          setData(next);
          setDraft(next.path);
          setHistory((h) => recordPath(h, next.path, job.historyIndex));
          setSizes({});
          setContext(null);
        }
      },
      onError: (error, job) => {
        if (valid(job.session) && job.sequence === seq.current) setError(errorMessage(error));
      },
      onFinish: (job) => {
        if (valid(job.session) && job.sequence === seq.current) setLoading(false);
      },
    });
  function load(
    path?: string,
    historyIndex?: number,
    { fresh = false }: { fresh?: boolean } = {},
  ): Promise<void> {
    const s = { ...current.current };
    if (!s.connected) {
      setError('连接终端后即可浏览文件');
      return Promise.resolve();
    }
    return directoryLoader.current!.load({
      key: JSON.stringify([s.id, s.generation, path ?? null, historyIndex ?? null]),
      session: s,
      path,
      historyIndex,
      fresh,
    });
  }

  useEffect(() => {
    ++taskEpoch.current;
    setOperationStatus('');
    directoryLoader.current?.invalidate();
    clearPress();
    pendingUpload.current = null;
    ++seq.current;
    upload.current?.abort();
    setData(null);
    setDraft('');
    setError('');
    setProgress(null);
    setHistory({ paths: [], index: -1 });
    setSizes({});
    setContext(null);
    setCalculating(null);
    setBusy(false);
    setLoading(false);
    if (open && session.connected) load();
  }, [session.id, session.generation, session.connected]);
  useEffect(
    () => () => {
      ++taskEpoch.current;
      directoryLoader.current?.invalidate();
      current.current = {
        ...current.current,
        connected: false,
        generation: current.current.generation + 1,
      };
      upload.current?.abort();
    },
    [],
  );
  function toggle() {
    setContext(null);
    clearPress();
    const next = !open;
    setOpen(next);
    if (next && session.connected) load(data?.path);
  }
  const { action, advancedAction, calculate } = createFileOperations({
    busy,
    session,
    current,
    directory,
    seq,
    data,
    valid,
    confirm,
    setBusy,
    setError,
    fileApi,
    toast,
    load,
    taskEpoch,
    setOperationStatus,
    calculating,
    setCalculating,
    setSizes,
  });
  const { selected, selectedFolder } = createFileUploadHandlers({
    busy,
    data,
    pendingUpload,
    current,
    directory,
    seq,
    upload,
    valid,
    setBusy,
    setError,
    setProgress,
    fileApi,
    toast,
    load,
  });
  return h(
    React.Fragment,
    null,
    h(
      'button',
      {
        className: 'terminal-files-toggle' + (open ? ' expanded' : ''),
        onClick: toggle,
        style: panelStyle,
        title: open ? '收起文件管理' : '展开文件管理',
        'aria-label': open ? '收起文件管理' : '展开文件管理',
        'aria-expanded': open,
        'aria-controls': panelId,
      },
      icon(open ? 'right' : 'left'),
    ),
    open &&
      h(
        'aside',
        {
          id: panelId,
          className: 'terminal-files-panel',
          'aria-label': '文件管理',
          style: panelStyle,
        },
        h('div', {
          className: 'terminal-files-resizer',
          role: 'separator',
          'aria-label': '调整文件管理宽度',
          'aria-orientation': 'vertical',
          ...resizerProps,
        }),
        h(
          FileToolbar,
          {
            draft,
            onDraft: setDraft,
            onGo: () => {
              void load(draft);
            },
            onBack: () => {
              void load(history.paths[history.index - 1], history.index - 1);
            },
            onForward: () => {
              void load(history.paths[history.index + 1], history.index + 1);
            },
            onRefresh: () => {
              void load(data?.path);
            },
            canBack: history.index >= 1,
            canForward: history.index < history.paths.length - 1,
            loading,
            connected: session.connected,
            summary: data ? `${data.files} 个文件，${data.directories} 个文件夹` : '当前连接的文件',
          },
          h('input', {
            type: 'file',
            multiple: true,
            hidden: true,
            ref: input,
            onChange: selected,
            'aria-label': '选择上传文件',
          }),
          h('input', {
            type: 'file',
            multiple: true,
            webkitdirectory: '',
            hidden: true,
            ref: folderInput,
            onChange: selectedFolder,
            'aria-label': '选择上传文件夹',
          }),
        ),
        operationStatus &&
          h('div', { className: 'terminal-files-operation', role: 'status' }, operationStatus),
        error && h('div', { className: 'terminal-files-error', role: 'alert' }, error),
        !session.connected &&
          h('p', { className: 'terminal-files-message' }, '连接已断开，请重连后浏览文件'),
        h(FileListing, {
          data,
          sizes,
          sort,
          setSort,
          calculating,
          context,
          showContext,
          touchStart,
          longPress,
          lastPointer,
          load,
          session,
          calculate,
          loading,
          clearPress,
          press,
          setContext,
        }),
        progress &&
          h(
            'div',
            { className: 'terminal-file-progress' },
            h(
              'div',
              null,
              h('span', { title: progress.name }, progress.name),
              h('span', null, progress.percent + '%'),
              h('button', { onClick: () => upload.current?.abort() }, '取消'),
            ),
            h('progress', { max: 100, value: progress.percent }),
          ),
      ),
    h(FileContextMenu, {
      context,
      setContext,
      current,
      directory,
      seq,
      fileApi,
      editText: (source: PositionedFileContext) => {
        void import('./terminal-text-editor.js')
          .then(({ openTextEditor }) => {
            if (!valid(source.session)) return;
            openTextEditor({
              fileApi,
              session: source.session,
              path: source.path.replace(/\/$/, '') + '/' + source.entry!.name,
              name: source.entry!.name,
              valid,
              confirm,
              toast,
              onSaved: () => {
                if (valid(source.session) && directory.current === source.path)
                  void load(source.path, undefined, { fresh: true });
              },
            });
          })
          .catch((e) => toast(errorMessage(e)));
      },
      toast,
      advancedAction,
      action,
      pendingUpload,
      input,
      folderInput,
    }),
  );
}
