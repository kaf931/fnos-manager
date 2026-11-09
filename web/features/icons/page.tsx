import { useEffect, useRef, useState } from 'react';
import type { IconEntry, MenuPage } from '../../../backend/domain/icons.js';
import type { ContainerSummary, ContainerPort } from '../../../backend/domain/docker.js';
import { errorMessage, type ApiClient, type Toast, type AppState } from '../../contracts/shared.js';
import { IconCards, type IconCardAction, type IconInstallStatus } from '../../icon-cards.js';
import { ContainerList } from '../../container-list.js';
import { ContainerPicker } from '../../container-picker.js';
import { NativeSelect } from '../../native-select.js';
import { AppIcon } from '../../ui/icon-markup.js';
import { ReactDialog } from '../../ui/react-dialog.js';
import { PullRefresh } from '../../pull-refresh.js';
import { EmptyState } from '../../empty-state.js';
import { confirmAction } from '../../confirmation.js';
import { containerAddress } from '../../docker-address.js';
import { menuTitles, isPageId } from '../../menu-definitions.js';
const base = '/app/deskicons/api';
import fallback from '../../assets/brand/nas-manager.png';
type Services = { api: ApiClient; toast: Toast };
interface DiscoveredIcon {
  image: string;
  source: string;
}
export function IconsPage({
  services: { api, toast },
  state,
  active,
  revision = 0,
}: {
  services: Services;
  state: AppState;
  active: boolean;
  revision?: number;
}) {
  const [entries, setEntries] = useState<IconEntry[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState(''),
    [editor, setEditor] = useState<{ entry: IconEntry | null } | null>(null),
    [installing, setInstalling] = useState(new Map<string, IconInstallStatus>());
  const generation = useRef(0),
    locks = useRef(new Set<string>());
  async function load() {
    const ticket = ++generation.current;
    try {
      const data = await api<IconEntry[]>('/entries');
      if (ticket === generation.current) {
        setEntries(data);
        setError('');
      }
    } catch (e) {
      if (ticket === generation.current) setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [api, revision]);
  const shown = entries.filter(
    (e) =>
      (filter === 'all' ||
        (filter === 'menu'
          ? !!e.menuPage
          : filter === 'docker'
            ? !!e.containerId
            : !e.containerId && !e.menuPage)) &&
      `${e.name} ${e.url}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  async function action(action: IconCardAction, entry: IconEntry) {
    try {
      if (action === 'edit') {
        setEditor({ entry });
        return;
      }
      if (action === 'package') {
        const a = document.createElement('a');
        a.href = `${base}/entries/${entry.id}/package`;
        a.download = '';
        a.click();
        return;
      }
      if (action === 'delete') {
        await confirmAction({
          title: '删除图标',
          text: `删除“${entry.name}”及本应用创建的桌面入口？原 Docker 服务不会被删除。`,
          danger: true,
          accept: '删除',
          onAccept: async () => {
            await api('/entries/' + entry.id, 'DELETE');
            await load();
            toast('图标已删除');
          },
        });
        return;
      }
      if (!state.native) {
        toast('请安装飞牛原生版本后使用，也可以下载入口安装包');
        return;
      }
      if (locks.current.has(entry.id)) return;
      locks.current.add(entry.id);
      setInstalling((v) => new Map(v).set(entry.id, 'installing'));
      try {
        const r = await api<{ message: string }>(`/entries/${entry.id}/apply`, 'POST', {});
        toast(r.message);
        await load();
        setInstalling((v) => {
          const n = new Map(v);
          n.delete(entry.id);
          return n;
        });
      } catch (e) {
        setInstalling((v) => new Map(v).set(entry.id, 'retry'));
        throw e;
      } finally {
        locks.current.delete(entry.id);
      }
    } catch (e) {
      toast(errorMessage(e));
    }
  }
  const options = [
    ['all', '全部'],
    ['docker', 'Docker 应用'],
    ['custom', '自定义'],
    ['menu', 'NAS 管家'],
  ];
  return (
    <section id="icons-page" className="tool-page" hidden={!active}>
      <header className="toolbar task-toolbar">
        <h1 className="sr-only">桌面图标</h1>
        <div className="task-toolbar-filters">
          <div className="search">
            <AppIcon name="search" />
            <input
              id="search"
              type="search"
              aria-label="搜索图标"
              placeholder="搜索名称或地址"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="task-status-field">
            <span id="icon-source-filter-label">来源</span>
            <div id="icon-source-filter" className="toolbar-select">
              <div className="desktop-toolbar-filter">
                <NativeSelect
                  aria-labelledby="icon-source-filter-label"
                  value={filter}
                  onChange={setFilter}
                  optionList={options.map(([value, label]) => ({ value, label }))}
                />
              </div>
              <div
                className="mobile-toolbar-filter"
                data-scroll-inset
                role="group"
                aria-labelledby="icon-source-filter-label"
              >
                {options.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={value === filter}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="toolbar-actions">
          <button
            id="add"
            className="primary"
            aria-label="添加图标"
            title="添加图标"
            onClick={() => setEditor({ entry: null })}
          >
            <AppIcon name="plus" />
            <span className="toolbar-action-label">添加图标</span>
          </button>
          <button
            id="reload"
            className="icon-button toolbar-refresh"
            aria-label="刷新图标"
            title="刷新图标"
            onClick={() => void load()}
          >
            <AppIcon name="refresh" />
            <span>刷新</span>
          </button>
        </div>
      </header>
      {!state.native && (
        <div className="notice">
          当前为本地开发预览。安装到飞牛后，可读取 Docker 并添加到真实桌面。
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <PullRefresh onRefresh={load}>
        {shown.length ? (
          <section id="cards" data-scroll-inset className="cards" aria-live="polite">
            <IconCards
              entries={shown}
              base={base}
              installing={installing}
              onAction={(a, e) => void action(a, e)}
            />
          </section>
        ) : (
          <EmptyState
            subject="图标"
            total={entries.length}
            onAdd={() => setEditor({ entry: null })}
            icon="grid"
            title="把常用应用放到桌面"
            description="选择 Docker 应用，或添加自己的链接和图标。"
          />
        )}
      </PullRefresh>
      {editor && (
        <IconEditor
          entry={editor.entry}
          entries={entries}
          api={api}
          state={state}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
            toast('图标已保存，可点击“添加到桌面”安装入口');
          }}
        />
      )}
    </section>
  );
}
function IconEditor({
  entry,
  entries,
  api,
  state,
  onClose,
  onSaved,
}: {
  entry: IconEntry | null;
  entries: IconEntry[];
  api: ApiClient;
  state: AppState;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [source, setSource] = useState<'docker' | 'custom' | 'menu'>(
      entry ? (entry.menuPage ? 'menu' : entry.containerId ? 'docker' : 'custom') : 'docker',
    ),
    [name, setName] = useState(entry?.name || ''),
    [url, setUrl] = useState(entry?.url || ''),
    [mode, setMode] = useState<IconEntry['mode']>(entry?.mode || 'url'),
    [menu, setMenu] = useState<MenuPage>(entry?.menuPage || 'terminal'),
    [image, setImage] = useState<string | null>(null),
    [imageSource, setImageSource] = useState(entry?.iconSource || '选择应用后自动获取'),
    [containers, setContainers] = useState<ContainerSummary[]>([]),
    [icons, setIcons] = useState(new Map<string, string>()),
    [selected, setSelected] = useState<ContainerSummary | null>(null),
    [query, setQuery] = useState(''),
    [port, setPort] = useState(''),
    [loading, setLoading] = useState(!entry),
    [loadError, setLoadError] = useState(''),
    [error, setError] = useState(''),
    [discovering, setDiscovering] = useState(false),
    [saving, setSaving] = useState(false);
  const alive = useRef(true),
    discovery = useRef(0),
    savingRef = useRef(false),
    file = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      alive.current = false;
      discovery.current++;
    },
    [],
  );
  const address = (c: ContainerSummary, p?: ContainerPort) =>
    containerAddress(c, p, state, location.hostname);
  useEffect(() => {
    if (entry) return;
    let current = true;
    void api<ContainerSummary[]>('/containers')
      .then(async (data) => {
        if (!current) return;
        setContainers(data);
        setLoading(false);
        const queue = [...data];
        await Promise.all(
          Array.from({ length: Math.min(3, queue.length) }, async () => {
            for (let c; (c = queue.shift());) {
              if (!current) break;
              try {
                const saved = entries.find((e) => e.containerId === c.id);
                let src = saved ? `${base}/entries/${saved.id}/icon?v=${saved.revision}` : '';
                if (!src) {
                  const target = address(c, c.ports[0]);
                  if (!target && !c.iconUrl) continue;
                  const result = await api<DiscoveredIcon>('/discover-icon', 'POST', {
                    url: target || undefined,
                    iconUrl: c.iconUrl || undefined,
                  });
                  if (result.source === '默认图标') continue;
                  src = result.image;
                }
                if (current) setIcons((old) => new Map(old).set(c.id, src));
              } catch {
                /* A failed optional preview must not block selecting the container. */
              }
            }
          }),
        );
      })
      .catch((e) => {
        if (current) {
          setLoading(false);
          setLoadError(errorMessage(e));
        }
      });
    return () => {
      current = false;
    };
  }, [api]);
  async function discover(target = url, container = selected) {
    const ticket = ++discovery.current;
    if (!target && !container?.iconUrl) {
      setDiscovering(false);
      setImageSource('无可用应用地址，可上传图标');
      return;
    }
    setDiscovering(true);
    setImageSource('正在自动获取…');
    try {
      const r = await api<DiscoveredIcon>('/discover-icon', 'POST', {
        url: target || undefined,
        iconUrl: container?.iconUrl || undefined,
      });
      if (alive.current && ticket === discovery.current) {
        setImage(r.image);
        setImageSource(r.source);
        setError(r.source === '默认图标' ? '未找到可用图标，可以上传自己的图片。' : '');
      }
    } catch (e) {
      if (alive.current && ticket === discovery.current) {
        setImageSource('默认图标');
        setError(errorMessage(e));
      }
    } finally {
      if (alive.current && ticket === discovery.current) setDiscovering(false);
    }
  }
  function choose(id: string) {
    const c = containers.find((c) => c.id === id);
    if (!c) return;
    setSelected(c);
    setName(c.name);
    const p = c.ports[0];
    setPort(String(p?.hostPort || ''));
    const target = address(c, p);
    setUrl(target);
    setImage(null);
    setError(!c.ports.length && !target ? '该容器没有映射 Web 端口，请填写可访问的应用地址。' : '');
    void discover(target, c);
  }
  function changeSource(next: typeof source) {
    discovery.current++;
    setDiscovering(false);
    setSource(next);
    setSelected(null);
    setError('');
    if (next === 'menu') {
      setName(menuTitles[menu]);
      setUrl(`/app/deskicons/?page=${menu}&standalone=1`);
      setMode('iframe');
      setImageSource('NAS 管家');
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current || discovering) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await api(entry ? '/entries/' + entry.id : '/entries', entry ? 'PUT' : 'POST', {
        name,
        menuPage: source === 'menu' ? menu : null,
        url,
        mode,
        containerId: source === 'docker' ? selected?.id || entry?.containerId || null : null,
        image,
        iconSource: imageSource,
      });
      if (alive.current) await onSaved();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  }
  const ports = selected ? [...new Map(selected.ports.map((p) => [p.hostPort, p])).values()] : [];
  return (
    <ReactDialog
      size="large"
      layout="workspace"
      id="editor"
      baseClassName=""
      open
      title={entry ? '编辑图标' : '添加图标'}
      onClose={onClose}
      busy={saving}
    >
      <form id="entry-form" onSubmit={(e) => void save(e)}>
        {!entry && (
          <div className="tabs" id="source-tabs">
            {(
              [
                ['docker', 'Docker 应用', 'docker'],
                ['custom', '自定义链接', 'link'],
                ['menu', '管家功能', 'grid'],
              ] as const
            ).map(([value, label, glyph]) => (
              <button
                key={value}
                type="button"
                className={source === value ? 'selected' : ''}
                onClick={() => changeSource(value)}
              >
                <AppIcon name={glyph} />
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="editor-body">
          {source === 'docker' && !entry && (
            <section id="docker-panel">
              <div className="docker-heading">
                <span id="container-picker-label">选择应用</span>
              </div>
              <div id="mobile-container-picker">
                <ContainerPicker
                  containers={containers}
                  selected={selected}
                  icons={icons}
                  loading={loading}
                  error={loadError}
                  onChange={choose}
                />
              </div>
              {loadError && (
                <p id="mobile-container-status" className="help">
                  {loadError}，也可以选择自定义链接。
                </p>
              )}
              <div className="search small">
                <AppIcon name="search" />
                <input
                  aria-label="搜索容器"
                  placeholder="搜索容器名称"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div id="container-list" className="container-list">
                <ContainerList
                  containers={containers.filter((c) =>
                    `${c.name} ${c.image}`.toLowerCase().includes(query.toLowerCase()),
                  )}
                  icons={icons}
                  selectedId={selected?.id}
                  loading={loading}
                  error={loadError}
                  onSelect={choose}
                  onIconError={(id) =>
                    setIcons((v) => {
                      const n = new Map(v);
                      n.delete(id);
                      return n;
                    })
                  }
                />
              </div>
            </section>
          )}
          <section className="form-panel">
            <div className="icon-field">
              <button
                type="button"
                className="upload-preview"
                id="upload-button"
                title="上传图标"
                onClick={() => file.current?.click()}
              >
                <img
                  id="icon-preview"
                  alt="图标预览"
                  src={
                    image ||
                    (entry ? `${base}/entries/${entry.id}/icon?v=${entry.revision}` : fallback)
                  }
                />
                <span className="upload-badge">
                  <AppIcon name="upload" />
                </span>
              </button>
              <div>
                <strong>应用图标</strong>
                <p>
                  {source === 'custom' && imageSource === '选择应用后自动获取'
                    ? '填写地址后可自动获取图标'
                    : imageSource}
                </p>
                <button type="button" className="text-button" onClick={() => file.current?.click()}>
                  上传图片
                </button>
                {source !== 'menu' && (
                  <>
                    <span className="sep">·</span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={discovering}
                      onClick={() => void discover()}
                    >
                      自动获取
                    </button>
                  </>
                )}
              </div>
              <input
                ref={file}
                type="file"
                value=""
                hidden
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const ticket = ++discovery.current;
                  setDiscovering(false);
                  if (f.size > 5 * 1024 * 1024) {
                    setError('图片不能超过 5 MB');
                    return;
                  }
                  setDiscovering(true);
                  setError('');
                  const reader = new FileReader();
                  const failed = () => {
                    if (alive.current && ticket === discovery.current) {
                      setDiscovering(false);
                      setError('图片读取失败，请重新选择文件');
                    }
                  };
                  reader.onload = () => {
                    if (
                      alive.current &&
                      ticket === discovery.current &&
                      typeof reader.result === 'string'
                    ) {
                      setImage(reader.result);
                      setImageSource('本地上传');
                      setError('');
                      setDiscovering(false);
                    } else if (typeof reader.result !== 'string') failed();
                  };
                  reader.addEventListener('error', failed);
                  reader.addEventListener('abort', failed);
                  try {
                    reader.readAsDataURL(f);
                  } catch {
                    failed();
                  }
                }}
              />
            </div>
            <label htmlFor="name">图标名称</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
              placeholder="例如：思源笔记"
            />
            {source === 'menu' && (
              <>
                <label htmlFor="menu-page">选择功能</label>
                <NativeSelect
                  id="menu-page"
                  value={menu}
                  optionList={Object.entries(menuTitles)
                    .filter(([key]) => key !== 'notifications')
                    .map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  onChange={(value) => {
                    if (isPageId(value) && value !== 'notifications') {
                      setMenu(value);
                      setName(menuTitles[value]);
                      setUrl(`/app/deskicons/?page=${value}&standalone=1`);
                    }
                  }}
                />
              </>
            )}
            {ports.length > 1 && (
              <div id="port-row">
                <label htmlFor="ports">访问端口</label>
                <NativeSelect
                  id="ports"
                  value={port}
                  optionList={ports.map((p) => ({
                    value: String(p.hostPort),
                    label: `${p.hostPort} → ${p.containerPort}`,
                  }))}
                  onChange={(value) => {
                    setPort(value);
                    const p = ports.find((p) => String(p.hostPort) === value);
                    if (selected) {
                      const target = address(selected, p);
                      setUrl(target);
                      void discover(target);
                    }
                  }}
                />
              </div>
            )}
            {source !== 'menu' && (
              <>
                <label htmlFor="url">应用地址</label>
                <input
                  id="url"
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://192.168.1.35:8080"
                />
                <label id="entry-mode-label">打开方式</label>
                <div className="mode-options">
                  {(['iframe', 'url'] as const).map((value) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === value}
                        onChange={() => setMode(value)}
                      />
                      <AppIcon name={value === 'iframe' ? 'window' : 'external'} />
                      <span>{value === 'iframe' ? '飞牛窗口' : '浏览器标签页'}</span>
                    </label>
                  ))}
                </div>
                <p className="help">页面空白时请改用浏览器打开。</p>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
        <div className="dialog-footer">
          <span className="help">保存后可单独添加到桌面</span>
          <button type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={saving || discovering}>
            {saving ? '正在保存…' : '保存图标'}
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
