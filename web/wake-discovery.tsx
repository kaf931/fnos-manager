import { useEffect, useRef, useState } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { RecordList } from './record-list.js';
import { errorMessage } from './contracts/shared.js';
import type { DiscoveredDevice } from '../backend/wake-discovery.js';
import type { WakeDevice, WakeUiOptions } from './contracts/wake.js';
export function WakeDiscovery({
  api,
  toast,
  existing,
  onComplete,
  onClose,
}: WakeUiOptions & {
  existing: WakeDevice[];
  onComplete: () => Promise<void>;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]),
    [selected, setSelected] = useState(new Set<string>()),
    [added, setAdded] = useState(new Set<string>()),
    [scanning, setScanning] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [mobile, setMobile] = useState(() => matchMedia('(max-width:620px)').matches);
  const alive = useRef(true),
    saving = useRef(false);
  useEffect(() => {
    const media = matchMedia('(max-width:620px)'),
      change = () => setMobile(media.matches);
    media.addEventListener?.('change', change);
    return () => media.removeEventListener?.('change', change);
  }, []);
  useEffect(() => {
    alive.current = true;
    void api<{ networks: string[]; devices: DiscoveredDevice[] }>('/wake/discover', 'POST', {})
      .then((r) => {
        if (alive.current) {
          setDevices(r.devices);
          setStatus(`${r.networks.join('、')} · 发现 ${r.devices.length} 台设备`);
        }
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive.current) setScanning(false);
      });
    return () => {
      alive.current = false;
    };
  }, [api]);
  const saved = (mac: string) => added.has(mac) || existing.some((d) => d.mac === mac),
    available = devices.filter((d) => !saved(d.mac));
  async function add() {
    if (saving.current || !selected.size) return;
    saving.current = true;
    setBusy(true);
    setError('');
    let count = 0,
      failed = false;
    try {
      for (const d of devices.filter((d) => selected.has(d.mac) && !saved(d.mac))) {
        if (!alive.current) return;
        await api('/wake/devices', 'POST', {
          name: d.name,
          mac: d.mac,
          ip: d.ip,
          address: d.address,
          port: 9,
          connectionId: null,
          system: 'linux',
        });
        if (!alive.current) return;
        setAdded((s) => new Set([...s, d.mac]));
        setSelected((s) => new Set([...s].filter((m) => m !== d.mac)));
        count++;
      }
    } catch (e) {
      failed = true;
      if (alive.current) setError(errorMessage(e));
    }
    try {
      await onComplete();
    } catch (e) {
      failed = true;
      if (alive.current) setError(errorMessage(e));
    } finally {
      saving.current = false;
      if (alive.current) {
        setBusy(false);
        if (count) toast(`已添加 ${count} 台设备`);
        if (!failed) onClose();
      }
    }
  }
  return (
    <ReactDialog
      size="large"
      busy={busy}
      open
      title="扫描局域网"
      className="terminal-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="task-form-body">
        <p data-status aria-live="polite">
          {scanning ? '正在扫描局域网…' : status}
        </p>
        <p role="alert" className="form-error" hidden={!error}>
          {error}
        </p>
        {mobile ? (
          <RecordList
            loading={scanning}
            empty={error ? '扫描失败' : '未发现设备'}
            entries={devices.map((d) => ({
              id: d.mac,
              title: d.name,
              detail: d.mac,
              meta: d.ip,
              status: saved(d.mac) ? 'success' : '',
              statusLabel: saved(d.mac) ? '已添加' : '',
            }))}
            selection={{
              allLabel: '选择全部发现的设备',
              selected,
              eligible: new Set(available.map((d) => d.mac)),
              limit: available.length || 1,
              busy: busy || scanning,
              toggle: (mac) =>
                setSelected((old) => {
                  const next = new Set(old);
                  if (next.has(mac)) next.delete(mac);
                  else next.add(mac);
                  return next;
                }),
              toggleAll: () =>
                setSelected(
                  new Set(
                    available.every((d) => selected.has(d.mac)) ? [] : available.map((d) => d.mac),
                  ),
                ),
            }}
          />
        ) : (
          <table className="task-table dialog-table">
            <thead>
              <tr>
                <th className="col-selection">
                  <input
                    type="checkbox"
                    aria-label="选择全部发现的设备"
                    checked={!!available.length && available.every((d) => selected.has(d.mac))}
                    disabled={busy || scanning || !available.length}
                    onChange={(e) =>
                      setSelected(new Set(e.target.checked ? available.map((d) => d.mac) : []))
                    }
                  />
                </th>
                <th>名称</th>
                <th>IP 地址</th>
                <th>MAC 地址</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.mac}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={'选择 ' + d.ip}
                      disabled={busy || saved(d.mac)}
                      checked={selected.has(d.mac)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(d.mac);
                          else n.delete(d.mac);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td>
                    {d.name}
                    {saved(d.mac) ? ' · 已添加' : ''}
                  </td>
                  <td>{d.ip}</td>
                  <td>{d.mac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy || scanning || !selected.size}
          onClick={() => void add()}
        >
          添加所选设备
        </button>
      </div>
    </ReactDialog>
  );
}
