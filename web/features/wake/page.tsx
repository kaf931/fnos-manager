import { NativeSelect } from '../../native-select.js';
import { AppIcon } from '../../ui/icon-markup.js';
import React, { useEffect, useRef, useState } from 'react';
import type {
  WakeDevice,
  Connection,
  WakeUiOptions,
  WakeBatchResult,
} from '../../contracts/wake.js';
import { errorMessage } from '../../contracts/shared.js';
import { ReactDialog } from '../../ui/react-dialog.js';
import { confirmAction } from '../../confirmation.js';
import { createWakeMonitor, wakePresenceLabel, wakePresenceTitle } from '../../wake-monitor.js';
import { WakeDiscovery } from '../../wake-discovery.js';
import { WakeBatch, createPowerConfirmation } from '../../wake-batch.js';
import { wakeConnectionOptions, wakeConnectionStatus } from '../../wake-connections.js';
import { PullRefresh } from '../../pull-refresh.js';
import { EmptyState } from '../../empty-state.js';
import { ConnectionCards } from '../../terminal-connections.js';
export function WakePage({
  services: { api, toast },
  active,
}: {
  services: WakeUiOptions;
  active: boolean;
}) {
  const [rows, setRows] = useState<WakeDevice[]>([]),
    [error, setError] = useState(''),
    [monitoring, setMonitoring] = useState(false),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [editor, setEditor] = useState<{ row: WakeDevice | null } | null>(null),
    [discovery, setDiscovery] = useState(false),
    [batch, setBatch] = useState<Connection[] | null>(null),
    [batchLoading, setBatchLoading] = useState(false),
    [sending, setSending] = useState(new Set<string>());
  const locks = useRef(new Set<string>()),
    batchRequest = useRef(0),
    batchPending = useRef(false),
    monitor = useRef<ReturnType<typeof createWakeMonitor> | null>(null);
  useEffect(() => {
    const m = createWakeMonitor({
      api,
      onRows: (r) => {
        setRows(r);
        setError('');
      },
      onError: (e) => setError(errorMessage(e)),
      onBusy: setMonitoring,
    });
    monitor.current = m;
    return () => {
      m.dispose();
      monitor.current = null;
    };
  }, [api]);
  useEffect(() => {
    const sync = () => {
      monitor.current?.setActive(active && !document.hidden);
      if (active && !document.hidden) void monitor.current?.refresh(true);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      monitor.current?.setActive(false);
    };
  }, [active, api]);
  const load = async () => {
    await monitor.current?.reload();
  };
  useEffect(() => {
    batchPending.current = false;
    setBatchLoading(false);
    return () => {
      ++batchRequest.current;
      batchPending.current = false;
    };
  }, [active, api]);
  async function openBatch() {
    if (!active || batchPending.current || batch) return;
    const ticket = ++batchRequest.current;
    batchPending.current = true;
    setBatchLoading(true);
    try {
      const connections = await api<Connection[]>('/terminal/connections');
      if (ticket === batchRequest.current) setBatch(connections);
    } catch (e) {
      if (ticket === batchRequest.current) toast(errorMessage(e));
    } finally {
      if (ticket === batchRequest.current) {
        batchPending.current = false;
        setBatchLoading(false);
      }
    }
  }
  async function act(action: string, row: WakeDevice) {
    if (locks.current.has(row.id) || batch || batchPending.current) return;
    if (action === 'edit') {
      setEditor({ row });
      return;
    }
    locks.current.add(row.id);
    setSending(new Set(locks.current));
    try {
      if (action === 'check') {
        await monitor.current?.refresh(true, [row.id]);
        return;
      }
      if (action === 'delete') {
        if (
          !(await confirmAction({
            title: '删除设备',
            text: `删除“${row.name}”的唤醒配置？`,
            danger: true,
            accept: '删除',
          }))
        )
          return;
        await api('/wake/devices/' + row.id, 'DELETE');
        toast('设备已删除');
      } else if (action === 'shutdown' || action === 'reboot') {
        const c = (await api<Connection[]>('/terminal/connections')).find(
          (c) => c.id === row.connectionId,
        );
        if (!c) throw Error('关联的 SSH 连接已不存在，请编辑设备重新选择');
        if (!(await createPowerConfirmation()(action, [{ name: row.name, connection: c }]))) return;
        const r = await api<WakeBatchResult>('/wake/control', 'POST', {
          ids: [row.id],
          action,
          confirmed: true,
          targets: [
            {
              id: row.id,
              connectionId: row.connectionId,
              system: row.system || 'linux',
              host: c.host,
              port: c.port,
              username: c.username,
            },
          ],
        });
        const entry = r.results[0];
        if (!entry) throw Error('未收到设备执行结果');
        if (!entry.success) throw Error(entry.error);
        toast('电源命令已提交，请检查设备状态');
      } else {
        const r = await api<{ message: string }>('/wake/devices/' + row.id + '/wake', 'POST');
        toast(r.message);
      }
      await load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      locks.current.delete(row.id);
      setSending(new Set(locks.current));
    }
  }
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || (filter === 'ssh' ? !!r.connectionId : !r.connectionId)) &&
      `${r.name} ${r.mac} ${r.address} ${r.ip || ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <section id="wake-page" className="tool-page" hidden={!active}>
      <PullRefresh onRefresh={() => monitor.current?.refresh(true)}>
        <div className="terminal-list-view">
          <header className="toolbar task-toolbar">
            <div className="task-toolbar-filters">
              <div className="search">
                <AppIcon name="search" />
                <input
                  id="wake-search"
                  type="search"
                  aria-label="搜索唤醒设备"
                  placeholder="搜索名称或地址"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="task-status-field">
                <span id="wake-filter-label">类型</span>
                <div id="wake-kind-filter" className="toolbar-select">
                  <div className="desktop-toolbar-filter">
                    <NativeSelect
                      aria-labelledby="wake-filter-label"
                      value={filter}
                      onChange={setFilter}
                      optionList={[
                        ['all', '全部'],
                        ['ssh', '已关联'],
                        ['wake', '仅唤醒'],
                      ].map(([value, label]) => ({ value, label }))}
                    />
                  </div>
                  <div
                    className="mobile-toolbar-filter"
                    data-scroll-inset
                    role="group"
                    aria-labelledby="wake-filter-label"
                  >
                    {[
                      ['all', '全部'],
                      ['ssh', '已关联'],
                      ['wake', '仅唤醒'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={filter === value}
                        onClick={() => {
                          setFilter(value);
                        }}
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
                id="wake-discover"
                disabled={batchLoading}
                onClick={() => setDiscovery(true)}
                className="toolbar-manage"
                aria-label="扫描局域网"
                title="扫描局域网"
              >
                <AppIcon name="search" />
                <span className="toolbar-action-label">扫描局域网</span>
              </button>
              <button
                id="wake-manage"
                disabled={batchLoading}
                aria-busy={batchLoading}
                onClick={() => void openBatch()}
                className="toolbar-manage"
                aria-label="批量管理"
                title="批量管理"
              >
                <AppIcon name="grid" />
                <span className="toolbar-action-label">批量管理</span>
              </button>
              <button
                id="wake-add"
                disabled={batchLoading}
                className="primary"
                onClick={() => setEditor({ row: null })}
                aria-label="新增设备"
                title="新增设备"
              >
                <AppIcon name="plus" />
                <span className="toolbar-action-label">新增设备</span>
              </button>
              <button
                id="wake-reload"
                disabled={monitoring}
                onClick={() => void monitor.current?.refresh(true)}
                className="icon-button toolbar-refresh"
                aria-label="刷新"
                title="刷新"
              >
                <AppIcon name="refresh" />
                <span>刷新</span>
              </button>
            </div>
          </header>
          <p id="wake-error" className="notice error" role="alert" hidden={!error}>
            {error}
          </p>
          <div
            id="wake-cards"
            data-scroll-inset
            className="cards connection-cards"
            hidden={!shown.length}
          >
            <ConnectionCards
              rows={shown.map((r) => ({ ...r, busy: sending.has(r.id) }))}
              onAction={(a, r) => void act(a, r)}
              options={{
                moreMenu: true,
                description: (r) => r.mac,
                tag: (r) => `${r.address}:${r.port}`,
                meta: wakePresenceLabel,
                metaTitle: wakePresenceTitle,
                iconPath: 'M12 2v10M6 5a9 9 0 1 0 12 0',
                actionLabel: '唤醒设备',
                busyLabel: '处理中…',
                editLabel: '编辑设备',
                deleteLabel: '删除设备',
                extraActions: (r) => [
                  ['check', '检测状态', 'refresh'],
                  ...(r.connectionId
                    ? ([
                        ['shutdown', '关闭设备', 'power'],
                        ['reboot', '重启设备', 'refresh'],
                      ] as [string, string, string][])
                    : []),
                ],
              }}
            />
          </div>
          <EmptyState
            id="wake-empty"
            subject="设备"
            total={rows.length}
            hidden={!!shown.length}
            title="唤醒你的设备"
            icon="power"
            description="添加设备，由 NAS 发送局域网唤醒包。"
            buttonId="wake-empty-add"
            disabled={batchLoading}
            onAdd={() => setEditor({ row: null })}
          />
        </div>
        {editor && (
          <WakeEditor
            api={api}
            toast={toast}
            row={editor.row}
            onClose={() => setEditor(null)}
            onComplete={load}
          />
        )}{' '}
        {discovery && (
          <WakeDiscovery
            api={api}
            toast={toast}
            existing={rows}
            onComplete={load}
            onClose={() => setDiscovery(false)}
          />
        )}{' '}
        {batch && (
          <WakeBatch
            api={api}
            toast={toast}
            rows={rows}
            connections={batch}
            onComplete={load}
            onClose={() => setBatch(null)}
          />
        )}
      </PullRefresh>
    </section>
  );
}
function WakeEditor({
  api,
  toast,
  row,
  onClose,
  onComplete,
}: WakeUiOptions & {
  row: WakeDevice | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
      name: row?.name || '',
      mac: row?.mac || '',
      ip: row?.ip || '',
      address: row?.address || '255.255.255.255',
      port: String(row?.port || 9),
      connectionId: row?.connectionId || '',
      system: row?.system || 'linux',
    }),
    [connections, setConnections] = useState<Connection[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    saving = useRef(false);
  useEffect(() => {
    void api<Connection[]>('/terminal/connections')
      .then((rows) => {
        if (alive.current) {
          setConnections(rows);
          setDraft((d) => ({
            ...d,
            connectionId: rows.some((c) => c.id === d.connectionId && c.kind === 'remote')
              ? d.connectionId
              : '',
          }));
        }
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [api]);
  const field = (name: string, value: string) => setDraft((d) => ({ ...d, [name]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || loading) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const c = connections.find((c) => c.id === draft.connectionId);
      if (draft.connectionId && !c) throw Error('请选择有效 SSH 连接');
      if (c && !c.hasCredentials) throw Error('请先在远程连接中保存此连接的认证信息');
      await api('/wake/devices' + (row ? '/' + row.id : ''), row ? 'PUT' : 'POST', {
        ...draft,
        port: Number(draft.port),
        connectionId: draft.connectionId || null,
      });
      if (alive.current) onClose();
      await onComplete();
      toast('设备已保存');
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      id="wake-editor"
      busy={busy}
      className="terminal-dialog"
      open
      title={row ? '编辑设备' : '新增设备'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form id="wake-form" onSubmit={save}>
        <div className="task-form-body">
          {(
            [
              ['name', '设备名称'],
              ['mac', 'MAC 地址'],
              ['ip', '设备 IP（可选）'],
              ['address', '广播地址'],
              ['port', 'UDP 端口'],
            ] as const
          ).map(([name, label]) => (
            <label key={name}>
              {label}
              <input
                id={'wake-' + name}
                required={name !== 'ip'}
                type={name === 'port' ? 'number' : 'text'}
                min={name === 'port' ? 1 : undefined}
                max={name === 'port' ? 65535 : undefined}
                maxLength={name === 'name' ? 80 : name === 'mac' ? 17 : undefined}
                value={draft[name]}
                onChange={(e) => field(name, e.target.value)}
              />
            </label>
          ))}
          <label>
            电源控制 SSH 连接
            <NativeSelect
              id="wake-connection"
              aria-label="电源控制 SSH 连接"
              disabled={loading || busy}
              value={draft.connectionId}
              onChange={(value) => field('connectionId', value)}
              optionList={[
                { value: '', label: '不关联 SSH（仅网络唤醒）' },
                ...wakeConnectionOptions(connections),
              ]}
            />
          </label>
          <p className="help" id="wake-connection-status">
            {wakeConnectionStatus(connections, draft.connectionId)}
          </p>
          {draft.connectionId && (
            <label>
              目标操作系统
              <NativeSelect
                id="wake-system"
                aria-label="目标操作系统"
                value={draft.system}
                onChange={(value) => field('system', value)}
                optionList={[
                  { value: 'linux', label: 'Linux' },
                  { value: 'windows', label: 'Windows' },
                  { value: 'macos', label: 'macOS' },
                ]}
              />
              <p className="help">需确认 SSH 指纹；Linux/macOS 非 root 账号需免密 sudo 权限。</p>
            </label>
          )}
          <p className="help">设备需启用网络唤醒，并与 NAS 处于可广播的局域网。</p>
          <p id="wake-form-error" className="form-error" role="alert" hidden={!error}>
            {error}
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button id="wake-save" type="submit" className="primary" disabled={busy || loading}>
            保存设备
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
