interface PickerApp {
  ready(): Promise<unknown>;
  isWeb?: boolean;
  isStandaloneWeb?: boolean;
  pickFile(options: {
    title: string;
    directory: boolean;
    multiple: boolean;
    creatable: boolean;
  }): Promise<unknown>;
}
export function createOfficialDirectoryPicker({
  createApp = async () => {
    const { getPlatformApp } = await import('./platform.js');
    const existing = getPlatformApp();
    if (existing) return existing;
    const { TrimApp } = await import('@trimjs/web-app');
    return new TrimApp();
  },
  isHost = () =>
    window.parent !== window || /FNOS\/|FNAppType\/|FNAppVer\//.test(navigator.userAgent),
  timeoutMs = 2500,
}: { createApp?: () => Promise<PickerApp>; isHost?: () => boolean; timeoutMs?: number } = {}) {
  let app: PickerApp | undefined;
  return async () => {
    if (!isHost()) return { supported: false, path: null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      app = await Promise.race([
        (async () => {
          const candidate = app ?? (await createApp());
          await candidate.ready();
          return candidate;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('系统文件选择器初始化超时')), timeoutMs);
        }),
      ]);
    } catch {
      return { supported: false, path: null };
    } finally {
      clearTimeout(timer);
    }
    if (app.isWeb !== false && app.isStandaloneWeb !== false)
      return { supported: false, path: null };
    const paths = await app.pickFile({
      title: '选择扫描目录',
      directory: true,
      multiple: false,
      creatable: false,
    });
    return {
      supported: true,
      path: Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : null,
    };
  };
}
