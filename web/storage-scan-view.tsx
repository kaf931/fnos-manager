import { AutoScrollName } from './auto-scroll-name.js';
import { SortableHeader } from './sortable-header.js';
import React from 'react';
import { StorageToolbar } from './storage-toolbar.js';
import { AppIcon } from './ui/icon-markup.js';
import scanArtwork from './assets/brand/storage-scan.png';
import { DuplicateDetails } from './storage-duplicate-details.js';
import { TaskPagination } from './task-pagination.js';
import { formatSize } from './terminal-file-model.js';
import { selectScanFiles } from './storage-scan-model.js';
import type { ApiClient } from './contracts/shared.js';
import type {
  ScanMode,
  ScanRecord,
  ScanStage,
  ScanView,
  ScanSort,
  ScanEntry,
  ScanFile,
  StoragePage,
  IndexedDuplicateGroup,
} from './contracts/storage.js';
interface Options {
  mode: ScanMode;
  path: string;
  job: ScanRecord | null;
  active: boolean;
  onManage: (groups: IndexedDuplicateGroup[]) => void;
  api: ApiClient;
  reportError?: (error: unknown) => void;

  choose: (path?: string) => void;
  cancel: () => void;
  openFolder: (path: string) => void;
  onStage?: (stage: ScanStage) => void;
}
interface FileRow {
  name: string;
  path: string;
  type: string;
  size: number;
  files: number;
  modifiedAt?: number;
  extension?: string;
}
const fileRow = (entry: ScanEntry | ScanFile): FileRow => ({
  name: entry.name,
  path: entry.path,
  type: entry.type,
  size: entry.bytes,
  files: 'files' in entry ? entry.files : 0,
  modifiedAt: 'modifiedAt' in entry ? entry.modifiedAt : undefined,
  extension: 'extension' in entry ? entry.extension : undefined,
});
const date = (value: string | number | undefined) =>
  value === undefined
    ? '—'
    : new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
const artwork = (
  <img
    className="storage-artwork"
    src={scanArtwork}
    alt=""
    width="256"
    height="256"
    decoding="async"
  />
);
export function StorageScanView({
  mode,
  path,
  job,
  active,
  onManage,
  api,
  reportError,
  choose,
  cancel,
  openFolder,
  onStage,
}: Options) {
  const [stage, changeStage] = React.useState<ScanStage>(
    job?.status === 'running' ? 'progress' : 'details',
  );
  const [view, setView] = React.useState<ScanView>('files');
  const [sort, setSort] = React.useState<ScanSort>('size');
  const [descending, setDescending] = React.useState(true);
  const [age, setAge] = React.useState(0);
  const [minimum, setMinimum] = React.useState('0');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [mobileLimit, setMobileLimit] = React.useState(50);
  const [mobile, setMobile] = React.useState(() => matchMedia('(max-width:620px)').matches);
  const [selectedGroups, setSelectedGroups] = React.useState(new Set<number>());
  const [detailGroup, setDetailGroup] = React.useState<IndexedDuplicateGroup | null>(null);
  const [serverPage, setServerPage] = React.useState<StoragePage<ScanEntry | ScanFile> | null>(
    null,
  );
  React.useEffect(() => {
    const media = matchMedia('(max-width:620px)');
    const change = () => setMobile(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  React.useEffect(() => {
    setSelectedGroups(new Set());
    setDetailGroup(null);
    setPage(1);
    setMobileLimit(50);
  }, [job?.id, mode]);
  React.useEffect(() => {
    if (job?.status === 'running') changeStage('progress');
    else changeStage('details');
  }, [job?.status, job?.id]);
  React.useEffect(() => {
    onStage?.(stage);
  }, [stage]);
  React.useEffect(() => {
    let live = true;
    setServerPage(null);
    if (!active || stage !== 'details' || mode !== 'space' || !job?.result) return;
    const filtered = view !== 'directories' && (Number(minimum) > 0 || age > 0);
    const query = new URLSearchParams({
      page: String(filtered || mobile ? 1 : page),
      pageSize: String(filtered ? 200 : mobile ? Math.min(mobileLimit, 200) : pageSize),
      sort: sort === 'modified' ? 'modifiedAt' : sort,
      direction: descending ? 'desc' : 'asc',
      collection:
        view === 'directories' ? 'topDirectories' : view === 'large' ? 'largestFiles' : 'catalog',
    });
    void (async () => {
      const result = await api<StoragePage<ScanEntry | ScanFile>>(
        '/storage/scans/' + encodeURIComponent(job.id) + '/entries?' + query,
      );
      if (filtered || (mobile && mobileLimit > 200))
        for (
          let next = 2;
          next <= Math.ceil((filtered ? result.total : Math.min(mobileLimit, result.total)) / 200);
          next++
        ) {
          if (!live) return;
          query.set('page', String(next));
          const extra = await api<StoragePage<ScanEntry | ScanFile>>(
            '/storage/scans/' + encodeURIComponent(job.id) + '/entries?' + query,
          );
          result.items.push(...extra.items);
        }
      if (filtered) {
        result.items = result.items.filter(
          (item) =>
            item.bytes >= Number(minimum) * 1024 ** 2 &&
            (!age || ('modifiedAt' in item && item.modifiedAt < Date.now() - age * 86400000)),
        );
        result.total = result.items.length;
        if (!mobile) result.items = result.items.slice((page - 1) * pageSize, page * pageSize);
      }
      if (live)
        setServerPage({
          ...result,
          items: mobile ? result.items.slice(0, mobileLimit) : result.items,
        });
    })().catch((e) => {
      if (live) reportError?.(e);
    });
    return () => {
      live = false;
    };
  }, [
    api,
    active,
    job,
    stage,
    mode,
    page,
    pageSize,
    mobile,
    mobileLimit,
    sort,
    descending,
    view,
    minimum,
    age,
  ]);
  const allGroups = availableGroups();
  const groups = mobile
    ? allGroups.slice(0, mobileLimit)
    : allGroups.slice((page - 1) * pageSize, page * pageSize);
  const localFiles =
    view === 'directories'
      ? (job?.result?.entries || []).map(fileRow)
      : selectScanFiles(job?.result || {}, { view, minimumMiB: minimum, olderDays: age, sort }).map(
          fileRow,
        );
  const files = serverPage
    ? serverPage.items.map(fileRow)
    : mobile
      ? localFiles.slice(0, mobileLimit)
      : localFiles.slice((page - 1) * pageSize, page * pageSize);
  const total = mode === 'duplicates' ? allGroups.length : (serverPage?.total ?? localFiles.length);
  function warning() {
    if (!job) return '';
    const r = job.result,
      parts: string[] = [];
    if (job.status !== 'completed') parts.push(job.error || '扫描未完成，结果可能不完整。');
    if (r && mode === 'space' && !Array.isArray(r.catalog))
      parts.push('旧记录仅含目录统计，请重新扫描查看文件。');
    if (r?.errors) parts.push(`${r.errors} 个条目读取失败或扫描期间发生变化。`);
    if (r?.skippedLinks || r?.skippedMounts)
      parts.push(`跳过 ${r.skippedLinks || 0} 个链接、${r.skippedMounts || 0} 个其他挂载目录。`);
    if (job.persistenceError) parts.push(job.persistenceError);
    return parts.join(' ');
  }
  function availableGroups(): IndexedDuplicateGroup[] {
    const processed = new Set(
      (job?.duplicateActions || []).filter((a) => a.success).map((a) => a.path),
    );
    return (job?.result?.groups || [])
      .map((g, index) => ({ ...g, index, paths: g.paths.filter((p) => !processed.has(p)) }))
      .filter((g) => g.paths.length > 1);
  }
  function getSelectedGroups() {
    return availableGroups().filter((g) => selectedGroups.has(g.index));
  }
  function openDetails(index: number) {
    const group = availableGroups().find((g) => g.index === index);
    if (group) setDetailGroup(group);
  }
  function selectGroup(index: number, checked: boolean) {
    setSelectedGroups((old) => {
      const next = new Set(old);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }
  function metrics(entries: [string, string][]) {
    return entries.map(([label, value]) => (
      <article key={label}>
        <span>{label}</span>
        <strong>{value}</strong>
      </article>
    ));
  }
  function sortHeader(key: ScanSort, label: string) {
    return (
      <SortableHeader
        label={label}
        sortKey={key}
        direction={sort === key ? (descending ? 'descending' : 'ascending') : 'none'}
        onSort={() => {
          if (sort === key) setDescending(!descending);
          else {
            setSort(key);
            setDescending(key !== 'name');
          }
          setPage(1);
        }}
      />
    );
  }
  function action(e: FileRow, compact = false) {
    return view === 'directories' && e.type === 'directory' ? (
      <button className="text-button" data-analyze={e.path} onClick={() => choose(e.path)}>
        {compact ? e.name : '分析目录'}
      </button>
    ) : (
      <button
        className="text-button"
        data-open-folder={e.path.slice(0, e.path.lastIndexOf('/')) || '/'}
        onClick={() => openFolder(e.path.slice(0, e.path.lastIndexOf('/')) || '/')}
      >
        {compact ? e.name : '在文件整理中查看'}
      </button>
    );
  }
  function renderUI() {
    const r = job?.result,
      duplicate = mode === 'duplicates';
    const notes = [
      warning(),
      !duplicate && view === 'files' && r?.catalogTruncated
        ? '索引已达上限，请缩小目录范围重新扫描。'
        : '',
      r?.truncated ? '部分目录或重复路径因结果数量限制未展示。' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const groupName = (g: IndexedDuplicateGroup) => g.paths[0]?.split('/').pop() || '';
    const groupType = (g: IndexedDuplicateGroup) =>
      groupName(g).includes('.') ? (groupName(g).split('.').pop() || '').toUpperCase() : '文件';
    const groupCheckbox = (g: IndexedDuplicateGroup) => (
      <input
        type="checkbox"
        data-group-select={g.index}
        aria-label={`选择 ${groupName(g)} 的重复组`}
        checked={selectedGroups.has(g.index)}
        onChange={(e) => selectGroup(g.index, e.currentTarget.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    );
    return (
      <>
        <section className="storage-scan-progress" hidden={stage !== 'progress'}>
          <div className="empty-symbol storage-illustration storage-scan-animated">{artwork}</div>
          <h2>正在扫描</h2>
          <p className="help storage-scan-target" data-progress-path>
            {job?.path || path}
          </p>
          <div className="storage-scan-metrics" data-progress-metrics>
            {metrics([
              ['已扫描文件', String(job?.progress.files || 0)],
              ['文件逻辑大小', formatSize(job?.progress.bytes || 0)],
              mode === 'duplicates'
                ? ['已校验内容', formatSize(job?.progress.hashedBytes || 0)]
                : ['已扫描目录', String(job?.progress.directories || 0)],
            ])}
          </div>
          <p className="help">正在读取文件信息…</p>
          <button data-cancel onClick={cancel}>
            取消扫描
          </button>
        </section>
        <section className="storage-scan-details" hidden={stage !== 'details'}>
          <header className="storage-result-heading" hidden>
            <div>
              <h2 data-detail-title>
                {duplicate
                  ? '重复文件对照'
                  : view === 'directories'
                    ? '目录占用'
                    : view === 'large'
                      ? '最大的文件'
                      : '全部文件'}
              </h2>
              <p className="help storage-scan-target" data-detail-path>
                {job?.path || path}
              </p>
            </div>
          </header>
          <p className="notice" data-detail-warning hidden={!notes}>
            {notes}
          </p>
          <div className="storage-detail-filters" hidden>
            <div className="storage-filter-tabs" role="group" aria-label="文件视图">
              {(['directories', 'files', 'large'] as const).map((value) => (
                <button
                  key={value}
                  data-view={value}
                  className={view === value ? 'selected' : ''}
                  disabled={value !== 'directories' && !Array.isArray(r?.catalog)}
                  onClick={() => {
                    setView(value);
                    setPage(1);
                    setMobileLimit(50);
                  }}
                >
                  {value === 'directories' ? '目录占用' : value === 'files' ? '全部文件' : '大文件'}
                </button>
              ))}
            </div>
            <label>
              至少{' '}
              <input
                data-minimum
                type="number"
                min="0"
                value={minimum}
                aria-label="最小文件大小 MiB"
                onChange={(e) => {
                  setMinimum(e.currentTarget.value);
                  setPage(1);
                }}
              />{' '}
              MiB
            </label>
            <div className="storage-filter-tabs" role="group" aria-label="修改时间筛选">
              {[0, 90, 365].map((value) => (
                <button
                  data-age={value}
                  key={value}
                  className={age === value ? 'selected' : ''}
                  onClick={() => {
                    setAge(value);
                    setPage(1);
                  }}
                >
                  {value === 0 ? '全部时间' : value === 90 ? '90 天未修改' : '一年未修改'}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap storage-detail-table" hidden={mobile}>
            <table
              className={'task-table storage-table' + (duplicate ? ' storage-duplicate-table' : '')}
            >
              <thead>
                {duplicate ? (
                  <tr>
                    <th className="col-selection">
                      <input
                        type="checkbox"
                        data-group-all
                        aria-label="选择当前页重复组"
                        disabled={!groups.length}
                        checked={
                          !!groups.length && groups.every((g) => selectedGroups.has(g.index))
                        }
                        onChange={(e) => {
                          for (const g of groups) {
                            selectGroup(g.index, e.currentTarget.checked);
                          }
                        }}
                      />
                    </th>
                    <th>文件名</th>
                    <th>文件类型</th>
                    <th>重复数量</th>
                  </tr>
                ) : (
                  <tr>
                    {sortHeader('name', '名称 / 路径')}
                    <th>类型</th>
                    {sortHeader('size', '文件逻辑大小')}
                    {view === 'directories' ? <th>文件数</th> : sortHeader('modified', '修改时间')}
                    <th>操作</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {duplicate ? (
                  mobile ? null : groups.length ? (
                    groups.map((g) => (
                      <tr
                        data-group-details={g.index}
                        tabIndex={0}
                        key={g.index}
                        onClick={() => openDetails(g.index)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openDetails(g.index);
                          }
                        }}
                      >
                        <td className="col-selection">{groupCheckbox(g)}</td>
                        <td>
                          <button
                            className="text-button storage-group-name"
                            data-group-open={g.index}
                          >
                            {groupName(g)}
                          </button>
                        </td>
                        <td>{groupType(g)}</td>
                        <td>{g.count ?? g.paths.length}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>{job ? '没有待处理的重复文件' : '暂无重复检查记录'}</td>
                    </tr>
                  )
                ) : files.length ? (
                  files.map((e) => (
                    <tr key={e.path}>
                      <td>
                        <strong title={e.path}>{e.name}</strong>
                        <small className="storage-file-path">{e.path}</small>
                      </td>
                      <td>{e.type === 'directory' ? '文件夹' : e.extension || '文件'}</td>
                      <td>{formatSize(e.size)}</td>
                      <td>{view === 'directories' ? e.files : date(e.modifiedAt)}</td>
                      <td>{action(e)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>没有匹配的文件</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="storage-detail-cards history-compact-list" hidden={!mobile}>
            {duplicate ? (
              mobile &&
              (groups.length ? (
                groups.map((g) => (
                  <article className="history-compact-row" key={g.index}>
                    {groupCheckbox(g)}
                    <AutoScrollName>
                      <button
                        className="text-button"
                        data-group-open={g.index}
                        title={groupName(g)}
                        onClick={() => openDetails(g.index)}
                      >
                        {groupName(g)}
                      </button>
                    </AutoScrollName>
                    <span className="history-compact-meta muted">{groupType(g)}</span>
                    <span className="history-compact-count">{g.count ?? g.paths.length} 个</span>
                  </article>
                ))
              ) : (
                <p className="help">暂无重复检查记录</p>
              ))
            ) : files.length ? (
              files.map((e) => (
                <article className="history-compact-row" key={e.path} title={e.path}>
                  <AutoScrollName>{action(e, true)}</AutoScrollName>
                  <span className="history-compact-meta muted">
                    {e.type === 'directory' ? '文件夹' : e.extension || '文件'}
                  </span>
                  <span className="history-compact-count">{formatSize(e.size)}</span>
                </article>
              ))
            ) : (
              <p className="help">没有匹配的文件</p>
            )}
          </div>
          <button
            data-more
            hidden={!mobile || total <= mobileLimit}
            onClick={() => {
              setMobileLimit((v) => v + 50);
            }}
          >
            加载更多
          </button>
          <div
            className="task-pagination native-pagination"
            aria-label={mode === 'space' ? '空间分析分页' : '重复文件分页'}
            data-pagination
            hidden={mobile}
          >
            <TaskPagination
              page={page}
              pageSize={pageSize}
              total={total}
              onChange={(p: number, size: number) => {
                setPage(size !== pageSize ? 1 : p);
                setPageSize(size);
              }}
            />
          </div>
        </section>
      </>
    );
  }
  return (
    <div id="storage-scan-root">
      {mode === 'duplicates' && stage === 'details' && (
        <StorageToolbar>
          <button
            aria-label="批量管理"
            title="批量管理"
            className="toolbar-manage"
            disabled={!getSelectedGroups().length}
            onClick={() => onManage(getSelectedGroups())}
          >
            <AppIcon name="grid" />
            <span className="toolbar-action-label">批量管理</span>
          </button>
        </StorageToolbar>
      )}
      {renderUI()}
      <DuplicateDetails group={detailGroup} onClose={() => setDetailGroup(null)} />
    </div>
  );
}
