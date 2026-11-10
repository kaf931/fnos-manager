import { DesktopNotificationInbox } from './notification-inbox.js';
import { useUpdateCheck, useUpdateActivity } from './update-check.js';
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { resolveMenuEntry } from './menu-entry.js';
import { menuTitles, type PageId } from './menu-definitions.js';
import { mobileNavigationIndex } from './navigation.js';
import { IconsPage } from './features/icons/page.js';
import { TasksPage } from './features/tasks/page.js';
import { StoragePage } from './features/storage/page.js';
import { WakePage } from './features/wake/page.js';
import { RemoteConnectionPage } from './features/terminal/page.js';
import { NotificationSettingsPage } from './notifications.js';
import { SettingsPage } from './system-settings.js';
import { ConfirmationHost } from './confirmation.js';
import { MobileMore } from './mobile-navigation-more.js';
import { AppIcon, NavigationArtwork } from './ui/icon-markup.js';
import { type AppState, type ApiClient, errorMessage } from './contracts/shared.js';
import { loadPreferences, getPreferences, subscribePreferences } from './preferences.js';
import { setupSharedScrollbars } from './shared-scrollbars.js';
import { setupMobileNavigation } from './mobile-navigation.js';
import { initPlatform } from './platform.js';
import { LoadingIndicator } from './loading-indicator.js';
class ErrorBoundary extends Component<
  { children: ReactNode; active: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="surface-error" role="alert" hidden={!this.props.active}>
        <span>界面暂时无法显示</span>
        <button onClick={() => this.setState({ failed: false })}>重试</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  const launch = useMemo(() => resolveMenuEntry(location.search), []);
  const [page, setPage] = useState<PageId>(launch.page),
    [state, setState] = useState<AppState>({
      native: false,
      gateway: false,
      csrfToken: '',
      version: '',
      hostname: '',
    }),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState(''),
    [bootstrapError, setBootstrapError] = useState(''),
    [bootstrapAttempt, setBootstrapAttempt] = useState(0),
    [moreOpen, setMoreOpen] = useState(false),
    [storageWorkspace, setStorageWorkspace] = useState(false),
    [revision, setRevision] = useState(0),
    [updateRequest, setUpdateRequest] = useState(0);
  const userNavigated = useRef(false);
  const token = useRef(''),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 4500);
  }, []);
  const api = useMemo<ApiClient>(
    () =>
      async (path, method = 'GET', data, signal) => {
        const response = await fetch('/app/deskicons/api' + path, {
          method,
          signal,
          headers: {
            'content-type': data instanceof Blob ? 'application/zip' : 'application/json',
            ...(token.current ? { 'x-deskicons-token': token.current } : {}),
          },
          body: data instanceof Blob ? data : data ? JSON.stringify(data) : undefined,
        });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          throw new Error(
            body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
              ? body.error
              : '请求失败',
          );
        }
        return response.status === 204 ? null : response.json();
      },
    [],
  );
  const release = useUpdateCheck(api, ready);
  const updateJob = useUpdateActivity(api, ready && !!release?.hasUpdate);
  const updateActive =
    !!updateJob && !['completed', 'failed', 'rolled-back', 'cancelled'].includes(updateJob.phase);
  const services = useMemo(() => ({ api, toast }), [api, toast]);
  useEffect(() => {
    let alive = true;
    setBootstrapError('');
    void (async () => {
      try {
        const next = await api<AppState>('/state');
        if (!alive) return;
        token.current = next.csrfToken;
        setState(next);
        await loadPreferences(api);
        if (!alive) return;
        if (!userNavigated.current)
          setPage(resolveMenuEntry(location.search, getPreferences().defaultPage).page);
        setReady(true);
      } catch (e) {
        if (alive) setBootstrapError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [api, bootstrapAttempt]);
  useEffect(() => {
    const stopMobile = setupMobileNavigation();
    const motion = () =>
      document.documentElement.classList.toggle(
        'navigation-motion-off',
        !getPreferences().navigationMotion,
      );
    motion();
    const unsubscribe = subscribePreferences(motion);
    void initPlatform();
    return () => {
      stopMobile();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (ready) return setupSharedScrollbars();
  }, [ready]);
  useLayoutEffect(() => {
    document.title = menuTitles[page];
    document.documentElement.dataset.page = page;
    document.documentElement.classList.toggle('standalone-entry', launch.standalone);
    document.documentElement.classList.toggle('mobile-more-open', moreOpen);
    document.documentElement.style.setProperty(
      '--nav-index',
      String(mobileNavigationIndex(page, moreOpen)),
    );
    window.dispatchEvent(
      new CustomEvent('deskicons:pagechange', { detail: { page, title: menuTitles[page] } }),
    );
  }, [page, moreOpen, launch]);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      'storage-focused',
      page === 'storage' && storageWorkspace,
    );
    return () => document.documentElement.classList.remove('storage-focused');
  }, [page, storageWorkspace]);
  const change = useCallback((value: PageId) => {
    userNavigated.current = true;
    setPage(value);
  }, []);
  return (
    <>
      <div className="layout">
        <aside className="sidebar" hidden={launch.standalone}>
          <nav>
            {(['icons', 'tasks', 'terminal', 'storage', 'wake', 'notifications'] as const).map(
              (key) => (
                <button
                  key={key}
                  className={'nav-item' + (page === key ? ' active' : '')}
                  data-page={key}
                  aria-current={page === key ? 'page' : undefined}
                  onClick={() => change(key)}
                >
                  <span>
                    <NavigationArtwork page={key} />
                  </span>
                  {menuTitles[key]}
                </button>
              ),
            )}
            <div id="mobile-more-root" className="mobile-more-root">
              <MobileMore
                page={page}
                onChange={change}
                onOpenChange={setMoreOpen}
                updateAvailable={!!release?.hasUpdate}
                onUpdate={() => {
                  change('settings');
                  setUpdateRequest((value) => value + 1);
                }}
              />
            </div>
          </nav>
          <div className="sidebar-bottom">
            <span id="environment">{state.version ? 'v' + state.version : '正在连接'}</span>
            <div className="sidebar-footer-actions">
              {release?.hasUpdate && (
                <button
                  type="button"
                  className="icon-button accent"
                  title={updateActive ? updateJob?.message : '发现新版本 ' + release.latest}
                  aria-label={
                    updateActive
                      ? '更新中，查看进度'
                      : '发现新版本 ' + release.latest + '，查看更新'
                  }
                  onClick={() => {
                    change('settings');
                    setUpdateRequest((value) => value + 1);
                  }}
                >
                  <>
                    {updateActive ? (
                      <span role="status" aria-live="polite">
                        {updateJob?.phase === 'downloading'
                          ? `${updateJob.total ? Math.min(100, Math.floor((updateJob.received / updateJob.total) * 100)) : 0}%`
                          : updateJob?.phase === 'verifying'
                            ? '校验中'
                            : updateJob?.phase === 'installing'
                              ? '安装中'
                              : updateJob?.phase === 'waiting'
                                ? '等待空闲'
                                : '重启中'}
                      </span>
                    ) : (
                      <AppIcon name="download" />
                    )}
                  </>
                </button>
              )}
              <button
                id="settings-open"
                className="icon-button"
                title="系统设置"
                aria-label="系统设置"
                onClick={() => change('settings')}
              >
                <AppIcon name="settings" />
              </button>
              <DesktopNotificationInbox api={api} toast={toast} active={ready} />
            </div>
          </div>
        </aside>
        <main>
          {!ready &&
            (bootstrapError ? (
              <div className="surface-error" role="alert">
                <span>{bootstrapError}</span>
                <button onClick={() => setBootstrapAttempt((n) => n + 1)}>重试</button>
              </div>
            ) : (
              <LoadingIndicator text="正在连接" />
            ))}
          {ready && (
            <>
              <ErrorBoundary active={page === 'icons'}>
                <IconsPage
                  services={services}
                  state={state}
                  active={page === 'icons'}
                  revision={revision}
                />
              </ErrorBoundary>
              <ErrorBoundary active={page === 'tasks'}>
                <TasksPage services={services} state={state} active={page === 'tasks'} />
              </ErrorBoundary>
              <ErrorBoundary active={page === 'terminal'}>
                <RemoteConnectionPage
                  services={services}
                  state={state}
                  active={page === 'terminal'}
                />
              </ErrorBoundary>
              <ErrorBoundary active={page === 'storage'}>
                <StoragePage
                  services={services}
                  active={page === 'storage'}
                  onWorkspaceChange={setStorageWorkspace}
                />
              </ErrorBoundary>
              <ErrorBoundary active={page === 'wake'}>
                <WakePage services={services} active={page === 'wake'} />
              </ErrorBoundary>
              <ErrorBoundary active={page === 'notifications'}>
                <NotificationSettingsPage {...services} active={page === 'notifications'} />
              </ErrorBoundary>
              <ErrorBoundary active={page === 'settings'}>
                <SettingsPage
                  {...services}
                  updateRequest={updateRequest}
                  state={state}
                  active={page === 'settings'}
                  onRestored={async () => setRevision((v) => v + 1)}
                />
              </ErrorBoundary>
            </>
          )}
        </main>
      </div>
      <ConfirmationHost />
      {notice && (
        <div id="toast" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
