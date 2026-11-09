import { NativeSelect } from '../../native-select.js';
import { AppIcon } from '../../ui/icon-markup.js';
import React, { useEffect, useRef, useState } from 'react';
import type { ApiClient, Toast, AppState } from '../../contracts/shared.js';
import { errorMessage } from '../../contracts/shared.js';
import type {
  TaskRecord,
  TaskCapabilities,
  Schedule,
  DeviceOption,
  OfficialStatus,
  TaskAction,
} from '../../contracts/tasks.js';
import { ReactDialog } from '../../ui/react-dialog.js';
import { confirmAction } from '../../confirmation.js';
import { TaskEnabledSwitch, taskEnableDisabledReason } from '../../task-enabled-switch.js';
import { MobileTaskCards } from '../../mobile-task-cards.js';
import { TaskPagination } from '../../task-pagination.js';
import { TaskHistory } from '../../task-history.js';
import { PullRefresh } from '../../pull-refresh.js';
import { EmptyState } from '../../empty-state.js';
import { taskTypeOptions } from '../../task-type-options.js';
const date = (v?: string | null) =>
  v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
const status = {
  success: '成功',
  failed: '失败',
  timeout: '超时',
  running: '执行中',
  interrupted: '已中断',
};
const frequency = (s: Schedule) =>
  s.kind === 'interval'
    ? `每 ${s.minutes} 分钟`
    : s.kind === 'once'
      ? `单次 · ${date(s.at)}`
      : s.kind === 'daily'
        ? `每天 ${s.time}`
        : `每周 ${s.days.map((d) => '日一二三四五六'[d]).join('、')} ${s.time}`;
const deviceTask = (type: string) => type.startsWith('device-');
type Services = { api: ApiClient; toast: Toast };
export function TasksPage({
  services: { api, toast },
  state,
  active,
}: {
  services: Services;
  state: AppState;
  active: boolean;
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]),
    [caps, setCaps] = useState<TaskCapabilities>(),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [editor, setEditor] = useState<{ task: TaskRecord | null } | null>(null),
    [history, setHistory] = useState<TaskRecord | null>(null),
    [official, setOfficial] = useState(false),
    [busy, setBusy] = useState(new Set<string>());
  const locks = useRef(new Set<string>()),
    generation = useRef(0);
  async function load() {
    const n = ++generation.current;
    try {
      const [t, c] = await Promise.all([
        api<TaskRecord[]>('/tasks'),
        api<TaskCapabilities>('/task-capabilities'),
      ]);
      if (n === generation.current) {
        setTasks(t);
        setCaps(c);
        setError('');
      }
    } catch (e) {
      if (n === generation.current) setError(errorMessage(e));
    }
  }
  useEffect(() => {
    if (!active) return;
    let reading = false,
      closed = false;
    const poll = async () => {
      if (closed || reading) return;
      reading = true;
      try {
        await load();
      } finally {
        reading = false;
      }
    };
    void poll();
    const visible = () => {
      if (!document.hidden) void poll();
    };
    const id = setInterval(visible, 4000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      closed = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', visible);
      ++generation.current;
    };
  }, [active, api]);
  const info = (type: string) => caps?.types.find((t) => t.id === type);
  async function summary(t: TaskRecord) {
    const rows = await api<DeviceOption[]>(
      '/task-device-options?type=' + encodeURIComponent(t.type),
    );
    return (t.deviceIds || [])
      .map((id) => {
        const r = rows.find((r) => r.id === id);
        return r ? `${r.name} · ${r.description}` : id + ' · 设备已不存在';
      })
      .join('\n');
  }
  async function act(action: TaskAction, id: string) {
    const t = tasks.find((t) => t.id === id);
    if (!t || locks.current.has(id)) return;
    if (action === 'edit') {
      setEditor({ task: t });
      return;
    }
    if (action === 'history') {
      setHistory(t);
      return;
    }
    locks.current.add(id);
    setBusy(new Set(locks.current));
    try {
      if ((action === 'run' || action === 'toggle') && t.pendingReason)
        throw Error(t.pendingReason + '，请先编辑任务');
      if (action === 'toggle') {
        const reason = taskEnableDisabledReason(t, caps);
        if (reason) throw Error(reason);
        if (
          !t.enabled &&
          ['device-reboot', 'device-shutdown'].includes(t.type) &&
          !(await confirmAction({
            title: '确认启用',
            text: `启用“${t.name}”？\n${await summary(t)}`,
            danger: true,
          }))
        )
          return;
        await api('/tasks/' + id, 'PUT', { ...t, enabled: !t.enabled });
      }
      if (action === 'delete') {
        if (
          !(await confirmAction({
            title: '删除任务',
            text: `删除任务“${t.name}”及其执行记录？`,
            danger: true,
          }))
        )
          return;
        await api('/tasks/' + id, 'DELETE');
      }
      if (action === 'run') {
        const p = await api<{
          revision: string;
          plan: unknown;
          notice: string;
          timeoutSeconds: number;
          retryCount: number;
        }>(`/tasks/${id}/preview`, 'POST');
        if (
          !(await confirmAction({
            title: '执行预览 · ' + t.name,
            text: [
              JSON.stringify(p.plan, null, 2),
              p.notice,
              `每次执行最长 ${p.timeoutSeconds} 秒 · 失败最多重试 ${p.retryCount} 次`,
              deviceTask(t.type) ? await summary(t) : '',
            ].join('\n'),
            accept: '确认执行',
            danger: !!info(t.type)?.dangerous,
          }))
        )
          return;
        await api(`/tasks/${id}/run`, 'POST', { confirmed: true, expectedRevision: p.revision });
        toast('任务已开始执行');
      }
      await load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      locks.current.delete(id);
      setBusy(new Set(locks.current));
    }
  }
  const shown = tasks.filter(
      (t) =>
        (filter === 'all' || t.enabled === (filter === 'enabled')) &&
        `${t.name} ${info(t.type)?.name}`.toLowerCase().includes(search.trim().toLowerCase()),
    ),
    current = Math.min(page, Math.max(1, Math.ceil(shown.length / size)));
  return (
    <section id="tasks-page" className="tool-page" hidden={!active}>
      <header className="toolbar task-toolbar">
        <div className="task-toolbar-filters">
          <div className="search">
            <AppIcon name="search" />
            <input
              id="task-search"
              type="search"
              placeholder="搜索任务名称"
              aria-label="搜索任务"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="task-status-field">
            <span id="task-filter-label">状态</span>
            <div id="task-status" className="toolbar-select">
              <div className="desktop-toolbar-filter">
                <NativeSelect
                  aria-labelledby="task-filter-label"
                  value={filter}
                  onChange={(value: string) => {
                    setFilter(value);
                    setPage(1);
                  }}
                  optionList={[
                    ['all', '全部'],
                    ['enabled', '已启用'],
                    ['disabled', '已暂停'],
                  ].map(([value, label]) => ({ value, label }))}
                />
              </div>
              <div
                className="mobile-toolbar-filter"
                data-scroll-inset
                role="group"
                aria-labelledby="task-filter-label"
              >
                {[
                  ['all', '全部'],
                  ['enabled', '已启用'],
                  ['disabled', '已暂停'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      setPage(1);
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
            id="open-official"
            onClick={() => setOfficial(true)}
            className="toolbar-manage"
            aria-label="官方授权"
            title="官方授权"
          >
            <AppIcon name="key" />
            <span className="toolbar-action-label">官方授权</span>
          </button>
          <button
            className="primary"
            id="new-task"
            disabled={!caps}
            onClick={() => setEditor({ task: null })}
            aria-label="新建任务"
            title="新建任务"
          >
            <AppIcon name="plus" />
            <span className="toolbar-action-label">新建任务</span>
          </button>
          <button
            id="reload-tasks"
            onClick={() => void load()}
            className="icon-button toolbar-refresh"
            aria-label="刷新"
            title="刷新"
          >
            <AppIcon name="refresh" />
            <span>刷新</span>
          </button>
        </div>
      </header>
      <PullRefresh onRefresh={load}>
        <p id="task-page-error" className="notice error" hidden={!error}>
          {error}
        </p>
        <div id="task-table-wrap" className="table-wrap" hidden={!shown.length}>
          <table className="task-table">
            <colgroup>
              <col />
              <col className="col-plan" />
              <col className="col-next" />
              <col className="col-result" />
              <col className="col-state" />
              <col className="col-actions" />
            </colgroup>
            <thead>
              <tr>
                {['任务名称', '执行计划', '下次执行', '上次结果', '启用', '操作'].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody id="task-rows">
              {shown.slice((current - 1) * size, current * size).map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <small>{info(t.type)?.name || t.type}</small>
                    {t.pendingReason && <small>{t.pendingReason}</small>}
                  </td>
                  <td>{frequency(t.schedule)}</td>
                  <td>{t.enabled ? date(t.nextRunAt) : '—'}</td>
                  <td>{status[t.lastRun?.status as keyof typeof status] || '未执行'}</td>
                  <td>
                    <TaskEnabledSwitch
                      task={t}
                      reason={taskEnableDisabledReason(t, caps)}
                      busy={busy.has(t.id)}
                      onToggle={() => void act('toggle', t.id)}
                    />
                  </td>
                  <td>
                    <div className="task-actions">
                      {(
                        [
                          ['run', '执行'],
                          ['edit', '编辑'],
                          ['history', '日志'],
                          ['delete', '删除'],
                        ] as const
                      ).map(([a, label]) => (
                        <button
                          key={a}
                          data-task-action={a}
                          data-id={t.id}
                          disabled={
                            busy.has(t.id) ||
                            (t.running && a !== 'history') ||
                            (!!t.pendingReason && a === 'run')
                          }
                          onClick={() => void act(a, t.id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section id="task-mobile-list" data-scroll-inset hidden={!shown.length}>
          <MobileTaskCards
            tasks={shown}
            info={info}
            frequency={frequency}
            date={date}
            status={status}
            toggling={busy}
            disabledReason={(t) => taskEnableDisabledReason(t, caps)}
            onAction={(a, id) => void act(a, id)}
          />
        </section>
        <EmptyState
          id="task-empty"
          subject="任务"
          total={tasks.length}
          hidden={!!shown.length}
          title="让日常操作按时完成"
          icon="clock"
          description="按计划执行命令、唤醒设备或处理日常任务。"
          buttonId="empty-task-add"
          disabled={!caps}
          onAdd={() => setEditor({ task: null })}
        />
        <div id="task-pagination" className="task-pagination" hidden={!shown.length}>
          <TaskPagination
            page={current}
            pageSize={size}
            total={shown.length}
            onChange={(p, s) => {
              setPage(s === size ? p : 1);
              setSize(s);
            }}
          />
        </div>
        {editor && caps && (
          <TaskEditor
            api={api}
            toast={toast}
            caps={caps}
            task={editor.task}
            native={state.native}
            onClose={() => setEditor(null)}
            onSave={load}
          />
        )}
        <TaskHistory api={api} toast={toast} task={history} onClose={() => setHistory(null)} />
        {official && (
          <OfficialAuth
            api={api}
            toast={toast}
            onClose={() => setOfficial(false)}
            onChange={load}
          />
        )}
      </PullRefresh>
    </section>
  );
}
function TaskEditor({
  api,
  toast,
  caps,
  task,
  native,
  onClose,
  onSave,
}: {
  api: ApiClient;
  toast: Toast;
  caps: TaskCapabilities;
  task: TaskRecord | null;
  native: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const s = task?.schedule;
  const [draft, setDraft] = useState({
    name: task?.name || '',
    type: task?.type || (native ? 'app' : 'script'),
    target: task?.target || '',
    action: task?.action || 'start',
    script: task?.script || '',
    timeout: String(task?.timeoutSeconds || 300),
    retries: String(task?.retryCount || 0),
    missed: task?.missedPolicy || 'skip',
    ack: task?.acknowledged || false,
    level: String(task?.level ?? 0),
    module: String(task?.module ?? 0),
    kind: s?.kind || 'daily',
    time: s && 'time' in s ? s.time : '03:00',
    minutes: s?.kind === 'interval' ? String(s.minutes) : '60',
    at:
      s?.kind === 'once' ? new Date(+new Date(s.at) + 8 * 3600000).toISOString().slice(0, 16) : '',
    days: s?.kind === 'weekly' ? s.days : ([] as number[]),
    ids: task?.deviceIds || [],
  });
  const [targets, setTargets] = useState<{ id: string; name: string }[]>([]),
    [devices, setDevices] = useState<DeviceOption[]>([]),
    [modules, setModules] = useState<{ id: number; label: string }[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  const alive = useRef(true),
    saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const field = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const requiresTarget = ['app', 'docker'].includes(draft.type),
    device = deviceTask(draft.type),
    limit = draft.type === 'device-wake' ? 50 : 10,
    repeatable =
      draft.type === 'device-wake' || (requiresTarget && ['start', 'stop'].includes(draft.action)),
    type = caps.types.find((t) => t.id === draft.type),
    targetAvailable = targets.some((t) => t.id === draft.target);
  useEffect(() => {
    let valid = true;
    setLoading(true);
    setError('');
    setTargets([]);
    setDevices([]);
    setModules([]);
    void (async () => {
      try {
        if (requiresTarget) {
          const rows = await api<{ id: string; name: string }[]>(
            draft.type === 'app' ? '/programs' : '/containers',
          );
          if (valid) {
            setTargets(rows);
            setDraft((d) => ({
              ...d,
              target: d.target || rows[0]?.id || '',
            }));
          }
        } else if (device) {
          const rows = await api<DeviceOption[]>('/task-device-options?type=' + draft.type);
          if (valid) {
            setDevices(rows);
            setDraft((d) => ({
              ...d,
              ids: d.ids
                .filter((id) => rows.some((r) => r.id === id && r.available))
                .slice(0, limit),
            }));
          }
        } else if (draft.type === 'log-clear') {
          const rows = await api<{ id: number; label: string }[]>('/official/log-modules');
          if (
            !rows.length ||
            rows.some(
              (r) =>
                !Number.isInteger(r.id) || r.id < -1 || r.id > 65535 || typeof r.label !== 'string',
            )
          )
            throw Error('无法识别官方日志模块列表');
          if (valid) {
            setModules(rows);
            setDraft((d) => ({
              ...d,
              module: rows.some((r) => String(r.id) === d.module) ? d.module : '',
            }));
          }
        }
      } catch (e) {
        if (valid) setError(errorMessage(e));
      } finally {
        if (valid) setLoading(false);
      }
    })();
    return () => {
      valid = false;
    };
  }, [draft.type, reload, api]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || loading) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      if (requiresTarget && !targets.some((r) => r.id === draft.target))
        throw Error('请先读取并选择有效目标');
      if (device && !draft.ids.length) throw Error('请选择目标设备');
      if (draft.type === 'log-clear' && !modules.some((r) => String(r.id) === draft.module))
        throw Error('请先读取并选择日志模块');
      const selected = devices.filter((r) => draft.ids.includes(r.id));
      if (['device-reboot', 'device-shutdown'].includes(draft.type)) {
        if (!draft.ack) throw Error('请确认此任务的影响范围');
        if (
          !(await confirmAction({
            title: '确认保存计划',
            text: `保存${type?.name}计划？启用后将按计划执行。\n${selected.map((r) => r.name + ' · ' + r.description).join('\n')}`,
            danger: true,
          }))
        )
          return;
        if (!alive.current) return;
      }
      const schedule: Schedule =
        draft.kind === 'interval'
          ? { kind: 'interval', minutes: Number(draft.minutes) }
          : draft.kind === 'once'
            ? { kind: 'once', at: draft.at }
            : draft.kind === 'weekly'
              ? { kind: 'weekly', time: draft.time, days: draft.days }
              : { kind: 'daily', time: draft.time };
      await api(task ? '/tasks/' + task.id : '/tasks', task ? 'PUT' : 'POST', {
        ...(task?.updatedAt ? { updatedAt: task.updatedAt } : {}),
        ...(task?.pendingReason ? { reviewedAfterRestore: true } : {}),
        name: draft.name,
        type: draft.type,
        enabled: task?.enabled || false,
        acknowledged: draft.ack,
        timeoutSeconds: Number(draft.timeout),
        retryCount: repeatable ? Number(draft.retries) : 0,
        missedPolicy: repeatable ? draft.missed : 'skip',
        schedule,
        target: draft.target,
        action: draft.action,
        script: draft.script,
        level: Number(draft.level),
        module: Number(draft.module),
        deviceIds: device ? draft.ids : [],
        deviceTargets: selected.flatMap((r) => (r.target ? [r.target] : [])),
      });
      if (alive.current) onClose();
      await onSave();
      toast('任务已保存');
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      size="large"
      layout="workspace"
      id="task-editor"
      busy={busy}
      open
      title={task ? '编辑任务' : '新建任务'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form id="task-form" onSubmit={save}>
        <div className="task-form-body">
          <p>中国标准时间 · UTC+8</p>
          <label>
            任务名称
            <input
              id="task-name"
              required
              maxLength={60}
              value={draft.name}
              onChange={(e) => field('name', e.target.value)}
            />
          </label>
          <label>
            任务类型
            <NativeSelect
              id="task-type"
              aria-label="任务类型"
              value={draft.type}
              onChange={(value) =>
                setDraft((d) => ({
                  ...d,
                  type: value as typeof d.type,
                  ack: false,
                  ids: [],
                  target: '',
                }))
              }
              optionList={taskTypeOptions(caps)}
            />
          </label>
          <p id="task-method" className="help">
            {type?.method}
          </p>
          {type?.notice && <p className="task-type-notice">{type.notice}</p>}
          {requiresTarget && (
            <div id="task-target-fields" className="form-grid">
              <label>
                目标程序
                <NativeSelect
                  id="task-target"
                  aria-label="目标程序"
                  disabled={loading || !targets.length}
                  value={draft.target}
                  onChange={(value) => field('target', value)}
                  optionList={[
                    ...(draft.target && !targetAvailable
                      ? [
                          {
                            value: draft.target,
                            label: `原目标不可用（${draft.target}）`,
                            disabled: true,
                          },
                        ]
                      : []),
                    ...targets.map((t) => ({
                      value: t.id,
                      label: /\$\{/.test(t.name) ? t.id : t.name,
                    })),
                  ]}
                />
              </label>
              <label>
                执行操作
                <NativeSelect
                  id="task-action"
                  aria-label="执行操作"
                  value={draft.action}
                  onChange={(value) => field('action', value as typeof draft.action)}
                  optionList={[
                    ['start', '启动'],
                    ['stop', '停止'],
                    ['restart', '重启'],
                  ].map(([value, label]) => ({ value, label }))}
                />
              </label>
            </div>
          )}
          {requiresTarget && draft.target && !targetAvailable && !loading && !error && (
            <p className="form-error" role="alert">
              原目标已不可用，请重新选择。
            </p>
          )}
          {device && (
            <div id="task-device-fields">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  aria-label="选择全部任务设备"
                  checked={
                    !!devices.filter((r) => r.available).length &&
                    draft.ids.length === Math.min(limit, devices.filter((r) => r.available).length)
                  }
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      ack: false,
                      ids: e.target.checked
                        ? devices
                            .filter((r) => r.available)
                            .slice(0, limit)
                            .map((r) => r.id)
                        : [],
                    }))
                  }
                />
                全选可用设备
              </label>
              {devices.map((r) => (
                <label key={r.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    disabled={
                      !r.available || (!draft.ids.includes(r.id) && draft.ids.length >= limit)
                    }
                    checked={draft.ids.includes(r.id)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        ack: false,
                        ids: e.target.checked
                          ? [...d.ids, r.id]
                          : d.ids.filter((id) => id !== r.id),
                      }))
                    }
                  />
                  {r.name} · {r.description}
                </label>
              ))}
              <p>
                已选择 {draft.ids.length} 台，最多 {limit} 台
              </p>
            </div>
          )}
          {draft.type === 'script' && (
            <label>
              脚本内容
              <textarea
                id="task-script"
                className="code-input"
                rows={7}
                value={draft.script}
                onChange={(e) => field('script', e.target.value)}
              />
            </label>
          )}
          {draft.type === 'log-clear' && (
            <div>
              <label>
                日志级别
                <NativeSelect
                  id="task-log-level"
                  aria-label="日志级别"
                  value={draft.level}
                  onChange={(value) => field('level', value)}
                  optionList={[
                    ['0', '普通'],
                    ['1', '警告'],
                    ['2', '错误'],
                    ['-1', '全部级别'],
                  ].map(([value, label]) => ({ value, label }))}
                />
              </label>
              <label>
                日志模块
                <NativeSelect
                  id="task-log-module"
                  aria-label="日志模块"
                  disabled={loading || !modules.length}
                  value={draft.module}
                  onChange={(value) => field('module', value)}
                  optionList={[
                    { value: '', label: '请选择日志模块' },
                    ...modules.map((m) => ({ value: String(m.id), label: m.label })),
                  ]}
                />
              </label>
              <button
                type="button"
                id="read-log-modules"
                disabled={loading}
                onClick={() => setReload((n) => n + 1)}
              >
                刷新日志模块
              </button>
            </div>
          )}
          <label>
            执行频率
            <NativeSelect
              id="task-schedule"
              aria-label="执行频率"
              value={draft.kind}
              onChange={(value) => field('kind', value as typeof draft.kind)}
              optionList={[
                ['daily', '每天'],
                ['weekly', '每周'],
                ['interval', '固定间隔'],
                ['once', '仅执行一次'],
              ].map(([value, label]) => ({ value, label }))}
            />
          </label>
          {['daily', 'weekly'].includes(draft.kind) && (
            <label>
              执行时间
              <input
                id="task-time"
                type="time"
                value={draft.time}
                onChange={(e) => field('time', e.target.value)}
              />
            </label>
          )}
          {draft.kind === 'interval' && (
            <label>
              间隔（分钟）
              <input
                id="task-minutes"
                type="number"
                min={1}
                max={10080}
                value={draft.minutes}
                onChange={(e) => field('minutes', e.target.value)}
              />
            </label>
          )}
          {draft.kind === 'once' && (
            <label>
              执行日期与时间
              <input
                id="task-once"
                type="datetime-local"
                required
                value={draft.at}
                onChange={(e) => field('at', e.target.value)}
              />
            </label>
          )}
          {draft.kind === 'weekly' && (
            <fieldset id="task-weekdays" className="weekday-options">
              <legend>执行日</legend>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    name="weekday"
                    checked={draft.days.includes(day)}
                    onChange={(e) =>
                      field(
                        'days',
                        e.target.checked
                          ? [...draft.days, day]
                          : draft.days.filter((d) => d !== day),
                      )
                    }
                  />
                  周{'日一二三四五六'[day]}
                </label>
              ))}
            </fieldset>
          )}
          <label>
            最长执行时长（秒）
            <input
              id="task-timeout"
              type="number"
              min={5}
              max={3600}
              value={draft.timeout}
              onChange={(e) => field('timeout', e.target.value)}
            />
          </label>
          <label>
            失败重试
            <NativeSelect
              id="task-retries"
              aria-label="失败重试"
              disabled={!repeatable}
              value={repeatable ? draft.retries : '0'}
              onChange={(value) => field('retries', value)}
              optionList={[0, 1, 2].map((n) => ({
                value: String(n),
                label: n ? `重试 ${n} 次` : '不重试',
              }))}
            />
          </label>
          <label>
            服务停机期间错过任务
            <NativeSelect
              id="task-missed"
              aria-label="服务停机期间错过任务"
              disabled={!repeatable}
              value={repeatable ? draft.missed : 'skip'}
              onChange={(value) => field('missed', value as typeof draft.missed)}
              optionList={[
                { value: 'skip', label: '跳过' },
                { value: 'once', label: '恢复后补跑一次' },
              ]}
            />
          </label>
          <p className="help">
            仅唤醒及程序/容器启停支持重试、补跑；重试间隔 30 秒，超时或中断除外。
          </p>
          {type?.dangerous && (
            <label className="checkbox-label impact-ack">
              <input
                id="task-ack"
                type="checkbox"
                checked={draft.ack}
                onChange={(e) => field('ack', e.target.checked)}
              />
              {type.notice}
            </label>
          )}
          <p id="task-form-error" role="alert" className="form-error" hidden={!error}>
            {error}
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            id="save-task"
            type="submit"
            className="primary"
            disabled={busy || loading || (requiresTarget && !targetAvailable)}
          >
            保存任务
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
function OfficialAuth({
  api,
  toast,
  onClose,
  onChange,
}: {
  api: ApiClient;
  toast: Toast;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const [status, setStatus] = useState<OfficialStatus>(),
    [origin, setOrigin] = useState(location.origin),
    [storage, setStorage] = useState(false),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    acting = useRef(false);
  async function load() {
    const s = await api<OfficialStatus>('/official/status');
    if (alive.current) {
      setStatus(s);
      setOrigin(s.origin || location.origin);
      setStorage(!!s.fileStorage);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load().catch((e) => setError(errorMessage(e)));
    return () => {
      alive.current = false;
    };
  }, []);
  async function act(action: string) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'authorize') {
        const r = await api<{ authorizationUrl: string }>('/official/authorize', 'POST', {
          origin,
          fileStorage: storage,
        });
        if (alive.current) setStatus((s) => ({ ...s!, authorizationUrl: r.authorizationUrl }));
      } else {
        const value = code;
        setCode('');
        await api('/official/' + action, 'POST', action === 'exchange' ? { code: value } : {});
        await load();
        await onChange();
        if (action === 'exchange') toast('官方授权已连接');
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      acting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      id="official-dialog"
      busy={busy}
      open
      title="官方授权"
      footer={
        <>
          <button type="button" disabled={busy} onClick={onClose}>
            关闭
          </button>
          {status?.connected ? (
            <button type="button" disabled={busy} onClick={() => void act('disconnect')}>
              断开授权
            </button>
          ) : status?.authorizationUrl ? (
            <button
              id="exchange-official"
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void act('exchange')}
            >
              连接授权
            </button>
          ) : (
            <button
              id="begin-official"
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void act('authorize')}
            >
              开始授权
            </button>
          )}
        </>
      }
      onClose={() => {
        if (!acting.current) onClose();
      }}
    >
      <div className="task-form-body">
        <label>
          访问地址
          <input id="official-origin" value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </label>
        <label className="checkbox-label">
          <input
            id="official-file-storage"
            aria-describedby="official-file-storage-help"
            type="checkbox"
            checked={storage}
            onChange={(e) => setStorage(e.target.checked)}
          />
          文件存储授权
        </label>
        <p id="official-file-storage-help" className="help">
          将授权凭据保存到本地文件，仅在系统密钥环不可用时启用。
        </p>
        {status?.connected && <p id="official-connected">已连接官方授权</p>}
        {status?.authorizationUrl && (
          <div id="official-pending">
            <a id="official-link" href={status.authorizationUrl} target="_blank" rel="noreferrer">
              打开授权页面
            </a>
            <label>
              授权码
              <input id="official-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          </div>
        )}
        <p role="alert" className="form-error" hidden={!error}>
          {error}
        </p>
      </div>
    </ReactDialog>
  );
}
