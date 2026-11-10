import { FeatureEntryCard } from '../../ui/feature-entry-card.js';
import { WorkspaceRail } from '../../ui/workspace-rail.js';
import React, { useEffect, useRef, useState } from 'react';
import type { ApiClient, Toast } from '../../contracts/shared.js';
import { errorMessage } from '../../contracts/shared.js';
import type {
  StorageMode,
  ScanStage,
  ScanMode,
  ScanRecord,
  RenameRecord,
  DirectoryListing,
  DuplicateGroup,
} from '../../contracts/storage.js';
import { StorageScanView } from '../../storage-scan-view.js';
import { StorageRename } from '../../storage-rename.js';
import { StorageHistory } from '../../storage-history.js';
import { StorageCleanup } from '../../storage-cleanup.js';
import { StorageAttachments } from '../../storage-attachments.js';
import { DuplicateManager } from '../../storage-duplicate-manager.js';
import { OperationRecords } from '../../operation-records.js';
import { NotificationRecords } from '../../notification-records.js';
import {
  MaintenanceRecords,
  isMaintenanceRecordMode,
  maintenanceRecordModes,
} from '../../maintenance-records.js';
import { RecordBatchControl } from '../../record-batch.js';
import { createOfficialDirectoryPicker } from '../../storage-picker.js';
import { ReactDialog } from '../../ui/react-dialog.js';
import { PullRefresh } from '../../pull-refresh.js';
import { StorageArtwork } from '../../storage-artwork.js';
import { AppIcon } from '../../ui/icon-markup.js';
import { StorageToolbar, StorageToolbarTarget } from '../../storage-toolbar.js';
const labels: Record<StorageMode, string> = {
  space: '空间分析',
  duplicates: '重复文件',
  rename: '文件整理',
  'scan-history': '扫描记录',
  'rename-history': '改名记录',
  cleanup: '应用清理',
  attachments: '应用附件',
  operations: '操作记录',
  deliveries: '投递记录',
  'task-runs': '任务运行记录',
  'restore-receipts': '配置恢复回执',
  'service-log': '服务日志',
  'update-cache': '更新缓存',
  'ai-chats': 'AI 对话历史',
};
const statuses: Record<string, string> = {
  running: '正在扫描',
  completed: '扫描完成',
  limited: '达到扫描上限',
  failed: '扫描失败',
  cancelled: '已取消',
  interrupted: '已中断',
};
export function StoragePage({
  services: { api, toast },
  active,
  onWorkspaceChange,
}: {
  services: { api: ApiClient; toast: Toast };
  active: boolean;
  onWorkspaceChange?: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<StorageMode>('space'),
    [workspace, setWorkspace] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [scanStage, setScanStage] = useState<ScanStage>('details');
  const [path, setPath] = useState(''),
    [jobs, setJobs] = useState<Partial<Record<ScanMode, ScanRecord | null>>>({});
  const [job, setJob] = useState<ScanRecord | null>(null),
    [renameRecord, setRenameRecord] = useState<RenameRecord | null>(null);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null),
    [recordManager, setRecordManager] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false),
    [picker, setPicker] = useState<DirectoryListing | null>(null),
    [pickerError, setPickerError] = useState(''),
    [pickerLoading, setPickerLoading] = useState(false),
    [choosingDirectory, setChoosingDirectory] = useState(false);
  const alive = useRef(active),
    epoch = useRef(0),
    interactionEpoch = useRef(0),
    browseEpoch = useRef(0),
    choosingDirectoryRef = useRef(false),
    pickerResolve = useRef<((path: string | null) => void) | null>(null);
  const officialPicker = useRef(createOfficialDirectoryPicker());
  alive.current = active;
  const report = (e: unknown) => {
    if (alive.current) toast(errorMessage(e));
  };
  const guard = (action: () => Promise<unknown>) => void action().catch(report);
  useEffect(() => {
    onWorkspaceChange?.(active && workspace);
    return () => onWorkspaceChange?.(false);
  }, [active, workspace, onWorkspaceChange]);
  useEffect(() => {
    if (!active) {
      ++epoch.current;
      ++interactionEpoch.current;
      ++browseEpoch.current;
      setGroups(null);
      setRecordManager(false);
      setPickerOpen(false);
      pickerResolve.current?.(null);
      pickerResolve.current = null;
    }
    return () => {
      ++epoch.current;
      ++interactionEpoch.current;
      ++browseEpoch.current;
    };
  }, [active]);
  useEffect(() => {
    alive.current = active;
    return () => {
      alive.current = false;
      pickerResolve.current?.(null);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let live = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const ticket = ++epoch.current;
    async function read() {
      setLoading(true);
      setError('');
      try {
        const list = await api<ScanRecord[]>('/storage/scans');
        const result = await Promise.all(
          (['space', 'duplicates'] as const).map(async (key) => {
            const row = list.find((x) => x.mode === key);
            return [key, row ? await api<ScanRecord>('/storage/scans/' + row.id) : null] as const;
          }),
        );
        if (!live || ticket !== epoch.current) return;
        const next = Object.fromEntries(result);
        setJobs(next);
        setPath((current) => current || list.find((scan) => scan.path)?.path || '');
        let current: ScanRecord | null = null;
        if (job?.id) {
          current =
            result.find(([, value]) => value?.id === job.id)?.[1] ||
            (await api<ScanRecord>('/storage/scans/' + job.id));
          if (!live || ticket !== epoch.current) return;
          setJob(current);
        }
        if (
          current?.status === 'running' ||
          result.some(([, value]) => value?.status === 'running')
        )
          timer = setTimeout(() => void read(), 900);
      } catch (e) {
        if (live && ticket === epoch.current) {
          setError(errorMessage(e));
          timer = setTimeout(() => void read(), 3000);
        }
      } finally {
        if (live && ticket === epoch.current) setLoading(false);
      }
    }
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, active, revision, job?.id, job?.status]);
  function switchMode(next: StorageMode) {
    ++interactionEpoch.current;
    finishPicker(null);
    setMode(next);
    setWorkspace(true);
    setGroups(null);
    setRenameRecord(null);
    if (next === 'space' || next === 'duplicates') {
      const last = jobs[next] || null;
      setJob(last);
      if (last) setPath(last.path);
    }
  }
  async function browse(target?: string | null) {
    const ticket = ++browseEpoch.current;
    setPickerLoading(true);
    setPickerError('');
    try {
      const next = await api<DirectoryListing>(
        '/storage/directories' + (target ? '?path=' + encodeURIComponent(target) : ''),
      );
      if (alive.current && ticket === browseEpoch.current) setPicker(next);
    } catch (e) {
      if (ticket === browseEpoch.current) setPickerError(errorMessage(e));
    } finally {
      if (ticket === browseEpoch.current) setPickerLoading(false);
    }
  }
  function finishPicker(value: string | null) {
    ++browseEpoch.current;
    setPickerOpen(false);
    const resolve = pickerResolve.current;
    pickerResolve.current = null;
    resolve?.(value);
  }
  async function pickDirectory(): Promise<string | null> {
    const ticket = interactionEpoch.current;
    const result = await officialPicker.current();
    if (!alive.current || ticket !== interactionEpoch.current) return null;
    if (result.supported) {
      if (!result.path) return null;
      const resolved = await api<{ path: string }>('/storage/resolve', 'POST', {
        path: result.path,
      });
      return alive.current && ticket === interactionEpoch.current ? resolved.path : null;
    }
    return new Promise((resolve) => {
      pickerResolve.current = resolve;
      setPicker(null);
      setPickerOpen(true);
      void browse(path);
    });
  }
  async function chooseDirectory(scan?: ScanMode) {
    if (choosingDirectoryRef.current) return;
    choosingDirectoryRef.current = true;
    setChoosingDirectory(true);
    try {
      const value = await pickDirectory();
      if (!value || !alive.current) return;
      setPath(value);
      if (scan) await startScan(scan, value);
    } finally {
      choosingDirectoryRef.current = false;
      setChoosingDirectory(false);
    }
  }
  async function startScan(selected: ScanMode, target = path) {
    if (!target) return;
    const ticket = interactionEpoch.current;
    const result = await api<ScanRecord>('/storage/scans', 'POST', {
      path: target,
      mode: selected,
    });
    if (!alive.current || ticket !== interactionEpoch.current) return;
    setMode(selected);
    setJob(result);
    setJobs((old) => ({ ...old, [selected]: result }));
    setWorkspace(true);
  }
  async function cancelScan(current: ScanRecord | null) {
    if (!current) return;
    const ticket = interactionEpoch.current;
    const result = await api<ScanRecord>('/storage/scans/' + current.id + '/cancel', 'POST', {});
    if (!alive.current || ticket !== interactionEpoch.current) return;
    setJob(result);
    setJobs((old) => ({ ...old, [result.mode]: result }));
    setRevision((v) => v + 1);
  }
  const reload = () => setRevision((v) => v + 1);
  const scan = mode === 'space' || mode === 'duplicates';
  return (
    <section
      id="storage-page"
      className={
        'tool-page' +
        (mode === 'space' ? ' storage-space-view' : '') +
        (scan && scanStage !== 'details' ? ' storage-overview' : '')
      }
      hidden={!active}
    >
      {!workspace ? (
        <section
          id="storage-entry"
          className="storage-entry"
          aria-label="存储管理"
          data-scroll-inset
        >
          <header className="storage-entry-status">
            <span className="storage-entry-status-icon">
              <StorageArtwork kind="scan" />
            </span>
            <div>
              <h2>选择扫描类型</h2>
              <p className="help">选择目录，分析空间占用或检查重复文件</p>
            </div>
          </header>
          {error && (
            <p role="alert" className="form-error">
              {error}
              <button onClick={reload}>重试</button>
            </p>
          )}
          <div className="storage-entry-cards">
            {(['space', 'duplicates'] as const).map((key) => {
              const last = jobs[key];
              return (
                <FeatureEntryCard
                  key={key}
                  title={labels[key]}
                  icon={<StorageArtwork kind={key} />}
                  description={
                    key === 'space'
                      ? '查看目录与文件大小，定位占用空间。'
                      : '检查内容相同的文件，整理重复副本。'
                  }
                >
                  <div className="storage-entry-last">
                    {last ? (
                      <>
                        <strong>{statuses[last.status] || last.status}</strong>
                        <span>{last.path}</span>
                        <span>
                          {new Date(last.finishedAt || last.startedAt).toLocaleString('zh-CN')}
                        </span>
                        <span>{last.result?.files ?? last.progress.files ?? 0} 个文件</span>
                      </>
                    ) : loading ? (
                      '正在读取上次结果…'
                    ) : (
                      '尚未扫描'
                    )}
                  </div>
                  <div className="storage-entry-buttons">
                    {last && (
                      <button onClick={() => switchMode(key)}>
                        {last.status === 'running' ? '查看进度' : '查看结果'}
                      </button>
                    )}
                    {last?.status === 'running' ? (
                      <button onClick={() => guard(() => cancelScan(last))}>取消扫描</button>
                    ) : (
                      <button
                        className="primary"
                        disabled={loading || choosingDirectory}
                        onClick={() => guard(() => chooseDirectory(key))}
                      >
                        {last ? '重新扫描' : '开始扫描'}
                      </button>
                    )}
                  </div>
                </FeatureEntryCard>
              );
            })}
          </div>
          <div className="storage-entry-links">
            {(['rename', 'cleanup'] as const).map((key) => (
              <article className="storage-entry-row shared-mobile-card" key={key}>
                <span className="storage-entry-row-icon">
                  <AppIcon name={key === 'rename' ? 'edit' : 'trash'} />
                </span>
                <div>
                  <h3>{labels[key]}</h3>
                  <p>{key === 'rename' ? '浏览文件并批量改名' : '清理历史记录与服务日志'}</p>
                </div>
                <button onClick={() => switchMode(key)}>打开</button>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div id="storage-workspace">
          <WorkspaceRail className="workspace-rail storage-workspace-nav" aria-label="存储管理功能">
            <button
              id="storage-back"
              className="icon-button"
              aria-label="返回存储管理"
              onClick={() => {
                if (
                  isMaintenanceRecordMode(mode) ||
                  [
                    'scan-history',
                    'rename-history',
                    'operations',
                    'deliveries',
                    'attachments',
                  ].includes(mode)
                )
                  switchMode('cleanup');
                else {
                  ++interactionEpoch.current;
                  setWorkspace(false);
                  finishPicker(null);
                }
              }}
            >
              <AppIcon name="back" />
            </button>
            <div
              className="workspace-rail-group storage-workspace-modes"
              role="tablist"
              aria-label="存储功能"
            >
              {(['space', 'duplicates', 'rename', 'cleanup'] as const).map((key) => (
                <button
                  key={key}
                  role="tab"
                  data-storage-mode={key}
                  aria-label={labels[key]}
                  aria-selected={mode === key}
                  onClick={() => switchMode(key)}
                >
                  <AppIcon
                    name={
                      key === 'space'
                        ? 'storage'
                        : key === 'duplicates'
                          ? 'file'
                          : key === 'rename'
                            ? 'edit'
                            : 'trash'
                    }
                  />
                </button>
              ))}
            </div>
          </WorkspaceRail>
          <div className="storage-workspace-content">
            <header
              className="storage-workspace-toolbar toolbar task-toolbar"
              hidden={scan && scanStage !== 'details'}
            >
              <h1 id="storage-menu-title">{labels[mode]}</h1>
              <div className="storage-workspace-actions">
                <div className="storage-toolbar-slot" ref={setToolbarTarget} />
                {mode === 'space' && scanStage === 'details' && (
                  <button
                    aria-label="批量管理"
                    title="批量管理"
                    className="toolbar-manage"
                    onClick={() => setRecordManager(true)}
                  >
                    <AppIcon name="grid" />
                    <span className="toolbar-action-label">批量管理</span>
                  </button>
                )}
                {mode === 'duplicates' && (
                  <button
                    className="toolbar-manage"
                    aria-label="更换目录"
                    title="更换目录"
                    disabled={loading || choosingDirectory}
                    onClick={() => guard(() => chooseDirectory('duplicates'))}
                  >
                    <AppIcon name="folder" />
                    <span className="toolbar-action-label">更换目录</span>
                  </button>
                )}
                <button
                  id="storage-reload"
                  className="toolbar-manage"
                  onClick={reload}
                  aria-label="刷新"
                  title="刷新"
                >
                  <AppIcon name="refresh" />
                  <span className="toolbar-action-label">刷新</span>
                </button>
              </div>
            </header>
            <StorageToolbarTarget.Provider value={toolbarTarget}>
              <PullRefresh onRefresh={reload} onError={report}>
                {scan ? (
                  <StorageScanView
                    key={mode}
                    api={api}
                    mode={mode}
                    path={path}
                    job={job}
                    active={active}
                    reportError={report}
                    choose={(target) => (target ? setPath(target) : guard(() => chooseDirectory()))}
                    cancel={() => guard(() => cancelScan(job))}
                    openFolder={(target) => {
                      setPath(target);
                      switchMode('rename');
                    }}
                    onStage={setScanStage}
                    onManage={setGroups}
                  />
                ) : mode === 'rename' ? (
                  <StorageRename
                    api={api}
                    toast={toast}
                    path={path}
                    active={active}
                    revision={revision}
                    initialRecord={renameRecord}
                    onChoose={() => guard(() => chooseDirectory())}
                    onPath={setPath}
                  />
                ) : mode === 'scan-history' ? (
                  <StorageHistory
                    api={api}
                    toast={toast}
                    active={active}
                    revision={revision}
                    onSelect={(result) => {
                      setJob(result);
                      setMode(result.mode);
                      setPath(result.path);
                    }}
                  />
                ) : mode === 'rename-history' ? (
                  <StorageHistory<RenameRecord>
                    api={api}
                    toast={toast}
                    active={active}
                    revision={revision}
                    source="/storage/rename/records"
                    title="改名记录"
                    onSelect={(result) => {
                      setRenameRecord(result);
                      setPath(result.path);
                      setMode('rename');
                    }}
                  />
                ) : mode === 'cleanup' ? (
                  <StorageCleanup
                    api={api}
                    toast={toast}
                    active={active}
                    revision={revision}
                    onOpen={switchMode}
                  />
                ) : mode === 'attachments' ? (
                  <StorageAttachments
                    api={api}
                    toast={toast}
                    active={active}
                    revision={revision}
                    onChanged={reload}
                  />
                ) : (
                  <Records
                    key={mode}
                    api={api}
                    toast={toast}
                    mode={mode}
                    active={active}
                    revision={revision}
                  />
                )}
              </PullRefresh>
            </StorageToolbarTarget.Provider>
          </div>
        </div>
      )}
      {groups && job && (
        <DuplicateManager
          api={api}
          toast={toast}
          job={job}
          groups={groups}
          pickDirectory={pickDirectory}
          onClose={() => setGroups(null)}
          onProcessed={async (id) => {
            const next = await api<ScanRecord>('/storage/scans/' + id);
            if (alive.current) {
              setJob(next);
              setJobs((old) => ({ ...old, duplicates: next }));
            }
          }}
        />
      )}
      {recordManager && (
        <ReactDialog
          size="large"
          layout="workspace"
          open
          onClose={() => setRecordManager(false)}
          title="批量管理空间分析记录"
          className="storage-record-manager list-management-dialog dialog-scroll-surface"
        >
          <div className="task-form-body">
            <StorageHistory
              api={api}
              toast={toast}
              active={active}
              modeFilter="space"
              managementOnly
              onSelect={() => {}}
              onDeleted={(ids) => {
                if (job && ids.includes(job.id)) setJob(null);
                reload();
              }}
            />
          </div>
        </ReactDialog>
      )}
      <ReactDialog
        id="storage-picker"
        open={pickerOpen}
        onClose={() => finishPicker(null)}
        title="选择目录"
        footer={
          <>
            <button onClick={() => finishPicker(null)}>取消</button>
            <button
              id="storage-use-directory"
              disabled={pickerLoading || !picker?.path}
              onClick={() => finishPicker(picker?.path || null)}
            >
              使用此目录
            </button>
          </>
        }
      >
        <div className="task-form-body">
          <button
            id="storage-parent"
            disabled={pickerLoading || !picker?.path}
            onClick={() => void browse(picker?.parent)}
          >
            上一级
          </button>
          <p id="storage-current-directory">{picker?.path || '存储位置'}</p>
          {pickerError && (
            <p role="alert" className="form-error">
              {pickerError}
            </p>
          )}
          <div id="storage-directory-list">
            {pickerLoading ? (
              <p role="status" className="help">
                正在读取目录…
              </p>
            ) : pickerError ? null : picker?.items.length ? (
              picker.items.map((item) => (
                <button
                  className="container-item"
                  key={item.path}
                  onClick={() => void browse(item.path)}
                >
                  {item.name}
                </button>
              ))
            ) : (
              <p role="status" className="help">
                暂无子目录，可使用此目录。
              </p>
            )}
          </div>
          {picker?.truncated && <p>只显示前 1000 个子目录。</p>}
        </div>
      </ReactDialog>
    </section>
  );
}
function Records({
  api,
  toast,
  mode,
  active,
  revision,
}: {
  api: ApiClient;
  toast: Toast;
  mode: StorageMode;
  active: boolean;
  revision: number;
}) {
  const [count, setCount] = useState(0);
  const batch = React.useMemo(
    () => new RecordBatchControl(() => setCount(batch.selectionCount()), toast),
    [toast],
  );
  return (
    <>
      <StorageToolbar>
        <button
          aria-label="批量管理"
          title="批量管理"
          className="toolbar-manage"
          disabled={!count}
          onClick={() => void batch.manage().catch((e) => toast(errorMessage(e)))}
        >
          <AppIcon name="grid" />
          <span className="toolbar-action-label">批量管理</span>
        </button>
      </StorageToolbar>
      {mode === 'operations' ? (
        <OperationRecords api={api} active={active} revision={revision} batch={batch} />
      ) : mode === 'deliveries' ? (
        <NotificationRecords api={api} active={active} revision={revision} batch={batch} />
      ) : isMaintenanceRecordMode(mode) ? (
        <MaintenanceRecords
          api={api}
          kind={active ? maintenanceRecordModes[mode] : null}
          revision={revision}
          batch={batch}
        />
      ) : null}
    </>
  );
}
