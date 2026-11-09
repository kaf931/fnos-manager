import { isPageId } from './menu-definitions.js';
import { getPreferences, subscribePreferences } from './preferences.js';
import { menuTitles } from './navigation.js';
import { TrimApp } from '@trimjs/web-app';
export function applyTheme(theme: string) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.setAttribute('theme-mode', dark ? 'dark' : 'light');
  document.body.setAttribute('data-palette', getPreferences().palette);
  document.body.setAttribute('data-terminal-background', getPreferences().terminalBackground);
}
let platformApp: TrimApp | undefined;
export const getPlatformApp = () => platformApp;
export async function initPlatform() {
  let sdk: TrimApp | undefined,
    embedded = false,
    dirty = false;
  const attempt = (fn: () => unknown | Promise<unknown>) =>
    Promise.resolve()
      .then(fn)
      .catch(() => {});
  const title = () => {
    const page = document.documentElement.dataset.page;
    const value = isPageId(page) ? menuTitles[page] : '桌面图标';
    document.title = value;
    if (sdk && embedded) attempt(() => sdk?.setTitle(value));
  };
  let terminalActive = false;
  const pending = (value: boolean) => {
    dirty = value;
    value = dirty || terminalActive;
    if (sdk && embedded)
      attempt(() =>
        sdk?.setExitPageTips(
          value
            ? { title: '离开应用？', content: '有未保存的内容或终端连接，离开后将结束。' }
            : undefined,
        ),
      );
  };
  window.addEventListener('deskicons:terminalstate', (e) => {
    terminalActive = e.detail.active;
    pending(dirty);
  });
  window.addEventListener('deskicons:editstate', (event) => {
    if (event instanceof CustomEvent) pending(Boolean(event.detail.dirty));
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty || terminalActive) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('deskicons:pagechange', title);
  const systemMedia = matchMedia('(prefers-color-scheme: dark)');
  let systemTheme = systemMedia.matches ? 'dark' : 'light';
  const refreshTheme = () =>
    applyTheme(getPreferences().theme === 'system' ? systemTheme : getPreferences().theme);
  subscribePreferences(refreshTheme);
  systemMedia.addEventListener('change', (event) => {
    systemTheme = event.matches ? 'dark' : 'light';
    refreshTheme();
  });
  refreshTheme();
  try {
    sdk = platformApp = new TrimApp();
    const config = await Promise.race([
      sdk.getPlatformConfig(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ]);
    systemTheme = config.theme === 'dark' ? 'dark' : 'light';
    refreshTheme();
    embedded = sdk.isWeb === true && sdk.isStandaloneWeb === false;
    if (config.language) document.documentElement.lang = config.language;
    if (embedded) {
      await sdk.$on('os/theme', (theme: unknown) => {
        systemTheme = theme === 'dark' ? 'dark' : 'light';
        refreshTheme();
      });
      await sdk.$on('os/language', (language: unknown) => {
        if (typeof language === 'string') document.documentElement.lang = language;
      });
      if (dirty || terminalActive)
        await sdk?.setExitPageTips({
          title: '离开应用？',
          content: '有未保存的内容或终端连接，离开后将结束。',
        });
    }
  } catch {
    // Keep appearance controls available even when platform discovery is unavailable.
  }
  title();
}
