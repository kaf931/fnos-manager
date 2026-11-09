import { DetailRow as Kv, DetailSection as Section } from './ui/detail-section.js';
import { SortableHeader } from './sortable-header.js';
import {
  createMonitorPoller,
  createMonitorHistory,
  filterMonitorNetworks,
  rankMonitorProcesses,
  type MonitorSample,
  type MonitorUpdate,
} from './terminal-monitor-model.js';
import type { MonitorData, SessionIdentity } from './contracts/terminal.js';
import type { ApiClient } from './contracts/shared.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NativeSelect } from './native-select.js';
const rate = (value: number | null | undefined) => (value == null ? '—' : Math.round(value) + '%');
const size = (value: number | null | undefined) => {
  if (value == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value,
    i = 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 1 : 0) + ' ' + units[i];
};
const duration = (seconds: number | null | undefined) =>
  seconds == null
    ? '—'
    : Math.floor(seconds / 86400) +
      ' 天 ' +
      Math.floor((seconds % 86400) / 3600) +
      ' 时 ' +
      Math.floor((seconds % 3600) / 60) +
      ' 分';
function Meter({
  label,
  percent,
  detail,
}: {
  label: string;
  percent?: number | null;
  detail?: string | null;
}) {
  return (
    <>
      <div className="terminal-monitor-heading">
        <span>{label}</span>
        <strong>{rate(percent)}</strong>
      </div>
      <progress max={100} value={percent ?? 0} aria-label={label + '使用率'} />
      {detail && <p>{detail}</p>}
    </>
  );
}
type Series = [
  keyof Pick<MonitorSample, 'cpu' | 'memory' | 'receive' | 'transmit'>,
  string,
  string,
];
function Chart({
  samples,
  series,
  max = 100,
}: {
  samples: MonitorSample[];
  series: Series[];
  max?: number;
}) {
  const segments = (key: Series[0]) => {
    const parts: string[][] = [];
    let current: string[] = [];
    const flush = () => {
      if (current.length) parts.push(current);
      current = [];
    };
    for (const sample of samples) {
      const value = sample[key];
      if (value == null) {
        flush();
        continue;
      }
      current.push(
        (Math.max(0, (sample.at - ((samples.at(-1)?.at ?? 0) - 180000)) / 180000) * 260).toFixed(
          1,
        ) +
          ',' +
          (70 - (Math.min(max, value) / max) * 60).toFixed(1),
      );
    }
    flush();
    return parts;
  };
  return (
    <>
      <svg
        viewBox="0 0 260 80"
        role="img"
        aria-label={series.map((s) => s[1]).join('、') + '最近采样趋势'}
        className="terminal-monitor-chart"
      >
        {[10, 40, 70].map((y) => (
          <line key={y} x1={0} x2={260} y1={y} y2={y} className="monitor-chart-grid" />
        ))}
        {series.flatMap(([key, , color]) =>
          segments(key).map((points, index) => (
            <polyline
              key={key + index}
              points={points.join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={1.7}
            />
          )),
        )}
      </svg>
      <div className="terminal-monitor-legend">
        {series.map(([key, label, color]) => (
          <span key={key} style={{ '--series-color': color } as React.CSSProperties}>
            {label}
          </span>
        ))}
      </div>
    </>
  );
}
export function TerminalMonitor({
  api,
  target,
  open,
  onClose,
  onData,
}: {
  api: ApiClient;
  target: SessionIdentity | null;
  open: boolean;
  onClose: () => void;
  onData: (data: MonitorData | null) => void;
}) {
  const [networkScope, setNetworkScope] = useState('common'),
    [processSort, setProcessSort] = useState('cpu'),
    [processDescending, setProcessDescending] = useState(true),
    [latest, setLatest] = useState<MonitorUpdate>({ data: null, message: '请先连接 SSH 主机' });
  const history = useMemo(() => createMonitorHistory(), []),
    onDataRef = useRef(onData);
  onDataRef.current = onData;
  const poller = useRef<ReturnType<typeof createMonitorPoller> | null>(null);
  const targetKey = target?.id + ':' + target?.generation;
  useEffect(() => {
    const value = createMonitorPoller({
      read: (id) => api<MonitorData>('/terminal/sessions/' + encodeURIComponent(id) + '/monitor'),
      update: (value) => {
        setLatest(value);
        onDataRef.current(value.data);
      },
    });
    poller.current = value;
    return () => {
      value.dispose();
      poller.current = null;
    };
  }, [api]);
  useEffect(() => {
    setNetworkScope('common');
    setProcessSort('cpu');
    setProcessDescending(true);
    poller.current?.select(target);
  }, [api, targetKey, target?.connected]);
  function renderNetworks(data: MonitorData | null) {
    return (
      <section className="terminal-monitor-card" hidden={!data}>
        <div className="terminal-monitor-heading terminal-monitor-network-header">
          <h3 className="terminal-monitor-section-title" id="terminal-monitor-network-label">
            网卡信息
          </h3>
          <div>
            <NativeSelect
              aria-labelledby="terminal-monitor-network-label"
              size="small"
              style={{ width: 104 }}
              value={networkScope}
              optionList={[
                { value: 'common', label: '常用' },
                { value: 'physical', label: '物理网卡' },
                { value: 'all', label: '全部' },
              ]}
              onChange={(value: string) => {
                setNetworkScope(value);
              }}
            />
          </div>
        </div>
        <div>
          {data &&
            (filterMonitorNetworks(data, networkScope).length ? (
              filterMonitorNetworks(data, networkScope).map((net) => (
                <div key={net.name} className="terminal-monitor-network">
                  <strong>{net.name}</strong>
                  <Kv
                    label="上行 / 下行"
                    value={size(net.transmitRate) + '/s · ' + size(net.receiveRate) + '/s'}
                  />
                  <Kv
                    label="累计发送 / 接收"
                    value={size(net.transmitted) + ' · ' + size(net.received)}
                  />
                  <p>{net.addresses.length ? net.addresses.join(' · ') : '暂无 IP 地址'}</p>
                </div>
              ))
            ) : (
              <p className="help">暂无符合条件的网卡</p>
            ))}
        </div>
      </section>
    );
  }
  const { data, message } = latest;
  const samples = useMemo(
    () => (data ? history.push(targetKey, data) : []),
    [data, history, targetKey],
  );
  return (
    <aside id="terminal-monitor" className="terminal-assets terminal-monitor" hidden={!open}>
      <>
        <div className="terminal-assets-header">
          <strong>系统监控</strong>
          <button aria-label="收起系统监控" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="terminal-monitor-body">
          <div className="terminal-monitor-sections">
            {!data ? (
              <p className="help">{message}</p>
            ) : (
              <>
                <Section title="主机信息">
                  <Kv label="主机" value={data.host?.name || '—'} />
                  <Kv label="用户" value={data.host?.user || '—'} />
                  <Kv label="系统" value={data.host?.system || '—'} />
                  <Kv label="内核" value={data.host?.kernel || '—'} />
                  <Kv label="运行时间" value={duration(data.host?.uptime)} />
                  <Kv
                    label="负载 1 / 5 / 15 分钟"
                    value={data.load?.length ? data.load.map((n) => n.toFixed(2)).join(' / ') : '—'}
                    className="terminal-monitor-load"
                  />
                </Section>
                <Section title="资源概览">
                  <Meter
                    label="CPU"
                    percent={data.cpu.percent}
                    detail={data.cpu.percent == null ? '等待下一次采样' : null}
                  />
                  <Meter
                    label="内存"
                    percent={data.memory.percent}
                    detail={size(data.memory.used) + ' / ' + size(data.memory.total)}
                  />
                  <Meter
                    label="Swap"
                    percent={data.swap?.percent}
                    detail={
                      data.swap?.total
                        ? size(data.swap.used) + ' / ' + size(data.swap.total)
                        : '未启用 Swap'
                    }
                  />
                </Section>
                <Section title="资源趋势 · 最近 3 分钟">
                  <Chart
                    samples={samples}
                    series={[
                      ['cpu', 'CPU', '#3478f6'],
                      ['memory', '内存', '#20a99b'],
                    ]}
                  />
                  <Kv
                    label={
                      data.defaultInterfaces?.length ? '默认网卡上行 / 下行' : '网卡上行 / 下行'
                    }
                    value={
                      size(samples.at(-1)?.transmit) +
                      '/s · ' +
                      size(samples.at(-1)?.receive) +
                      '/s'
                    }
                  />
                  <Chart
                    samples={samples}
                    series={[
                      ['transmit', '上行', '#f5a623'],
                      ['receive', '下行', '#51ad64'],
                    ]}
                    max={Math.max(1, ...samples.flatMap((s) => [s.receive || 0, s.transmit || 0]))}
                  />
                  <p>网速按当前峰值缩放；优先统计默认路由网卡</p>
                </Section>
                <Section title="每核 CPU">
                  {data.cpu.cores?.length ? (
                    data.cpu.cores.map((core) => (
                      <div key={core.id} className="terminal-monitor-core">
                        <span>CPU {core.id + 1}</span>
                        <progress
                          max={100}
                          value={core.percent ?? 0}
                          aria-label={'CPU ' + (core.id + 1) + '使用率'}
                        />
                        <span>{rate(core.percent)}</span>
                      </div>
                    ))
                  ) : (
                    <p>暂无每核数据</p>
                  )}
                </Section>
                <Section title="进程">
                  {data.processes?.length ? (
                    <table className="terminal-monitor-processes">
                      <thead>
                        <tr>
                          {[
                            ['name', '进程'],
                            ['pid', 'PID'],
                            ['cpu', 'CPU'],
                            ['memory', '内存'],
                          ].map(([key, label]) => {
                            const direction =
                              processSort === key
                                ? processDescending
                                  ? 'descending'
                                  : 'ascending'
                                : 'none';
                            return key === 'cpu' || key === 'memory' ? (
                              <SortableHeader
                                key={key}
                                label={label}
                                direction={direction}
                                ariaLabel={'按' + label + '占用排序'}
                                onSort={() => {
                                  setProcessDescending(
                                    processSort === key ? !processDescending : true,
                                  );
                                  setProcessSort(key);
                                }}
                              />
                            ) : (
                              <th key={key} scope="col">
                                {label}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {rankMonitorProcesses(data.processes, processSort, processDescending).map(
                          (p) => (
                            <tr key={p.pid}>
                              <td>
                                <span title={p.name}>{p.name}</span>
                              </td>
                              <td>{p.pid}</td>
                              <td>{p.cpu.toFixed(1)}%</td>
                              <td>{size(p.memory)}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <p>暂无进程数据或目标不支持 ps</p>
                  )}
                </Section>
              </>
            )}
          </div>
          {renderNetworks(data)}
          <div className="terminal-monitor-sections">
            {data && (
              <Section title="磁盘容量">
                <Meter
                  label="本地磁盘汇总"
                  percent={data.disk.percent}
                  detail={size(data.disk.used) + ' / ' + size(data.disk.total)}
                />
                {data.disks.map((disk) => (
                  <div key={disk.mount} className="terminal-monitor-network">
                    <Meter
                      label={disk.mount}
                      percent={disk.percent}
                      detail={size(disk.used) + ' / ' + size(disk.total)}
                    />
                  </div>
                ))}
              </Section>
            )}
          </div>
        </div>
      </>
    </aside>
  );
}
