import type { UpdateSettings } from '../backend/domain/updates.js';
import { useEffect, useRef, useState } from 'react';
import type { ApiClient, Toast } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import { NativeSelect } from './native-select.js';
export function UpdateMode({
  api,
  toast,
  active,
  field = 'mode',
}: {
  api: ApiClient;
  toast: Toast;
  active: boolean;
  field?: keyof UpdateSettings;
}) {
  const [settings, setSettings] = useState<UpdateSettings | null>(null),
    [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState(false),
    [busy, setBusy] = useState(false);
  const saving = useRef(false),
    notify = useRef(toast);
  notify.current = toast;
  useEffect(() => {
    if (!active || saving.current) return;
    let live = true;
    setReady(false);
    setLoadError(false);
    void api<UpdateSettings>('/updates/settings')
      .then((value) => {
        if (live) {
          setSettings({
            mode: value.mode === 'auto' ? 'auto' : 'manual',
            downloadRoute: value.downloadRoute === 'mirror' ? 'mirror' : 'direct',
          });
          setReady(true);
        }
      })
      .catch((error) => {
        if (live) {
          setLoadError(true);
          notify.current(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, [api, active]);
  async function save(value: unknown) {
    if (
      !active ||
      !ready ||
      saving.current ||
      !(field === 'mode' ? ['manual', 'auto'] : ['direct', 'mirror']).includes(String(value))
    )
      return;
    saving.current = true;
    setBusy(true);
    try {
      const next = await api<UpdateSettings>('/updates/settings', 'PUT', { [field]: value });
      setSettings(next);
      toast(
        field === 'downloadRoute'
          ? '默认下载线路已保存，失败时自动切换'
          : value === 'auto'
            ? '已开启自动更新，空闲时下载安装'
            : '已切换为手动更新',
      );
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <NativeSelect
      aria-label={field === 'mode' ? '更新方式' : '下载线路'}
      value={ready ? settings?.[field] : undefined}
      placeholder={loadError ? '读取失败' : '读取中…'}
      disabled={!active || !ready || busy}
      onChange={(value) => void save(value)}
      optionList={
        field === 'downloadRoute'
          ? [
              { value: 'direct', label: 'GitHub 直连' },
              { value: 'mirror', label: '镜像加速' },
            ]
          : [
              { value: 'manual', label: '手动更新' },
              { value: 'auto', label: '自动更新' },
            ]
      }
    />
  );
}
