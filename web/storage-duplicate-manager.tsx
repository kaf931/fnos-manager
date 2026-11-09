import React from 'react';
import { NativeSelect } from './native-select.js';
import { ReactDialog } from './ui/react-dialog.js';
import { duplicateProcessRequest, preferredDuplicateKeeper } from './storage-scan-model.js';
import { errorMessage } from './contracts/shared.js';
import type { ApiClient, Toast } from './contracts/shared.js';
import type { ScanRecord, DuplicateGroup, DuplicateOutcome } from './contracts/storage.js';
interface Options {
  api: ApiClient;
  toast: Toast;
  pickDirectory: () => Promise<string | null>;
  onProcessed: (id: string) => Promise<void>;
}
const name = (path: string) => path.split('/').pop() || path;
export function DuplicateManager({
  api,
  toast,
  pickDirectory,
  onProcessed,
  job,
  groups,
  onClose,
}: Options & { job: ScanRecord; groups: DuplicateGroup[]; onClose: () => void }) {
  const live = React.useRef(true),
    busyRef = React.useRef(false),
    pickingRef = React.useRef(false);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [keepers, setKeepers] = React.useState(
    () => new Map(groups.map((g, i) => [i, preferredDuplicateKeeper(g)])),
  );
  const [expanded, setExpanded] = React.useState(() => new Set([0]));
  const [action, setAction] = React.useState<'move' | 'delete'>('move');
  const [automatic, setAutomatic] = React.useState(true);
  const [preferredDirectory, setPreferredDirectory] = React.useState('');
  const [previewed, setPreviewed] = React.useState(false);
  const [destination, setDestination] = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const [error, setError] = React.useState('');
  const [results, setResults] = React.useState<DuplicateOutcome[] | null>(null);
  const items = groups.flatMap((g, i) =>
    g.paths
      .filter((path) => path !== keepers.get(i))
      .map((path) => ({ keep: keepers.get(i) || '', path, size: g.size })),
  );
  React.useEffect(() => {
    setPreviewed(false);
  }, [keepers, action, destination, preferredDirectory]);
  const close = () => {
    if (!busyRef.current) onClose();
  };
  async function chooseDirectory(preferred = false) {
    if (pickingRef.current || busyRef.current || finished) return;
    pickingRef.current = true;
    setPicking(true);
    setError('');
    try {
      const path = await pickDirectory();
      if (!path || !live.current) return;
      if (preferred) {
        setPreferredDirectory(path);
        setAutomatic(true);
        setKeepers(new Map(groups.map((g, i) => [i, preferredDuplicateKeeper(g, path)])));
      } else setDestination(path);
    } catch (e) {
      if (live.current) setError(errorMessage(e));
    } finally {
      pickingRef.current = false;
      if (live.current) setPicking(false);
    }
  }
  async function execute() {
    if (
      busyRef.current ||
      pickingRef.current ||
      finished ||
      !previewed ||
      !items.length ||
      items.length > 100 ||
      (action === 'move' && !destination)
    )
      return;
    busyRef.current = true;
    setWorking(true);
    setError('');
    try {
      const result = await api<{ results: DuplicateOutcome[] }>(
        '/storage/scans/' + job.id + '/duplicates/process',
        'POST',
        duplicateProcessRequest(action, destination, items),
      );
      if (!live.current) return;
      setFinished(true);
      setResults(result.results);
      toast('已处理 ' + result.results.filter((r) => r.success).length + ' 个重复副本');
      try {
        await onProcessed(job.id);
      } catch {
        if (live.current) toast('副本处理已完成，扫描结果刷新失败，请重新进入页面');
      }
    } catch (e) {
      if (live.current) setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      if (live.current) setWorking(false);
    }
  }
  return (
    <ReactDialog
      size="large"
      busy={working}
      open
      onClose={close}
      title="批量管理重复文件"
      className="storage-duplicate-dialog"
    >
      <div className="task-form-body">
        <p className="help">已选择 {groups.length} 组重复文件</p>
        <div className="duplicate-options-row">
          <div className="duplicate-action-field">
            <label id="duplicate-action-label">处理方式</label>
            <NativeSelect
              aria-labelledby="duplicate-action-label"
              value={action}
              disabled={working || picking || finished}
              optionList={[
                { value: 'move', label: '移动到指定目录' },
                { value: 'delete', label: '删除所选副本' },
              ]}
              onChange={(value: unknown) => {
                if (value === 'move' || value === 'delete') setAction(value);
              }}
            />
          </div>
          <div className="storage-duplicate-action-panel">
            <section data-target style={{ visibility: action === 'move' ? 'visible' : 'hidden' }}>
              <label>目标目录</label>
              <button
                className="storage-scan-location"
                data-directory
                disabled={working || picking || finished || action !== 'move'}
                onClick={() => void chooseDirectory()}
              >
                {destination || '点击选择目标目录'}
              </button>
            </section>
          </div>
        </div>
        <fieldset className="terminal-choice-field" disabled={working || picking || finished}>
          <legend>整理方式</legend>
          <div className="terminal-choice">
            <label>
              <input
                type="radio"
                name="duplicate-policy"
                value="auto"
                checked={automatic}
                onChange={() => {
                  setAutomatic(true);
                  setKeepers(
                    new Map(
                      groups.map((g, i) => [i, preferredDuplicateKeeper(g, preferredDirectory)]),
                    ),
                  );
                }}
              />
              <span>自动整理</span>
            </label>
            <label>
              <input
                type="radio"
                name="duplicate-policy"
                value="manual"
                checked={!automatic}
                onChange={() => setAutomatic(false)}
              />
              <span>手动选择保留</span>
            </label>
          </div>
        </fieldset>
        <fieldset className="terminal-choice-field" disabled={working || picking || finished}>
          <legend>优先保留目录</legend>
          <button
            type="button"
            className="storage-scan-location"
            onClick={() => void chooseDirectory(true)}
          >
            {preferredDirectory || '点击选择优先保留的目录（含子目录）'}
          </button>
          {preferredDirectory && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setPreferredDirectory('');
                setAutomatic(true);
                setKeepers(new Map(groups.map((g, i) => [i, preferredDuplicateKeeper(g)])));
              }}
            >
              清除保留目录
            </button>
          )}
          <details className="help-details">
            <summary>整理规则</summary>
            <p>优先保留指定目录内副本，其余按路径排序保留第一份；仅处理所选组的已显示副本。</p>
          </details>
          {groups.some((g) => g.pathsTruncated) && (
            <p className="form-error">部分副本未收录，请核对保留项。</p>
          )}
        </fieldset>
        {previewed && (
          <section aria-label="重复文件处理预览">
            <h3>处理预览</h3>
            <p className="help">
              将{action === 'delete' ? '删除' : '移动'} {items.length} 个副本
              {action === 'move' ? `，目标目录：${destination}` : ''}
              ，每组保留一份。
            </p>
            <div className="table-wrap storage-duplicate-preview">
              <table className="task-table storage-table">
                <thead>
                  <tr>
                    <th>保留副本</th>
                    <th>{action === 'delete' ? '待删除副本' : '待移动副本'}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.path}>
                      <td>{item.keep}</td>
                      <td>{item.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <div className="duplicate-grouped-list" aria-label="重复文件分组">
          {groups.map((g, i) => (
            <section className="duplicate-review-group" key={i}>
              <button
                type="button"
                className="duplicate-review-heading"
                data-group={i}
                aria-expanded={expanded.has(i)}
                disabled={working}
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                <strong>{name(g.paths[0] || '')}</strong>
                <span>{g.paths.length} 个文件</span>
              </button>
              <div
                className="duplicate-review-files"
                data-group-files={i}
                hidden={!expanded.has(i)}
              >
                {g.paths.map((path) => (
                  <label
                    key={path}
                    className={
                      'duplicate-file-option' + (keepers.get(i) === path ? ' selected' : '')
                    }
                  >
                    <input
                      type="radio"
                      name={'duplicate-keep-' + i}
                      data-keep-group={i}
                      value={path}
                      disabled={working || finished}
                      checked={keepers.get(i) === path}
                      onChange={() => {
                        setKeepers((prev) => new Map(prev).set(i, path));
                        setAutomatic(false);
                      }}
                    />
                    <span className="duplicate-file-copy">
                      <strong>{name(path)}</strong>
                      <small>{path}</small>
                    </span>
                    <span className="duplicate-file-state">
                      {keepers.get(i) === path ? '保留' : action === 'delete' ? '待删除' : '待移动'}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="form-error" data-error hidden={!error && items.length <= 100}>
          {items.length > 100 ? '每批最多处理100个副本，请减少所选重复组' : error}
        </p>
        <div data-results hidden={!results}>
          {results && (
            <>
              <p>
                已处理 {results.filter((r) => r.success).length} / {results.length} 个副本
              </p>
              {results
                .filter((r) => !r.success)
                .map((r) => (
                  <p className="form-error" key={r.path}>
                    {r.path}：{r.error}
                  </p>
                ))}
            </>
          )}
        </div>
      </div>
      <div className="dialog-footer">
        <button data-close disabled={working} onClick={close}>
          {finished ? '关闭' : '取消'}
        </button>
        <button
          data-execute
          hidden={finished}
          className={action === 'delete' ? 'danger' : 'primary'}
          disabled={
            working ||
            picking ||
            finished ||
            !items.length ||
            items.length > 100 ||
            (action === 'move' && !destination)
          }
          onClick={() => {
            if (previewed) void execute();
            else setPreviewed(true);
          }}
        >
          {!previewed ? '预览处理计划' : action === 'delete' ? '确认删除' : '确认移动'}
        </button>
      </div>
    </ReactDialog>
  );
}
