import { networkRates, formatTransferRate } from './terminal-monitor-model.js';
import type { MonitorData } from './contracts/terminal.js';
export function MonitorSummary({ data }: { data: MonitorData | null }) {
  const rate = (value: number | null | undefined) =>
    value == null ? '—' : Math.round(value) + '%';
  const rates = networkRates(data);
  return (
    <div className="terminal-monitor-summary" aria-label="当前主机资源与网络状态">
      {' '}
      <>
        {(
          [
            ['cpu', 'CPU'],
            ['memory', '内存'],
            ['disk', '磁盘'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} title={label + '：' + rate(data?.[key]?.percent)}>
            <span>{label}</span>
            <strong data-monitor={key}>{rate(data?.[key]?.percent)}</strong>
          </div>
        ))}
        {(
          [
            ['upload', '上传', 'transmit'],
            ['download', '下载', 'receive'],
          ] as const
        ).map(([key, label, field]) => {
          const value = formatTransferRate(rates[field]);
          return (
            <div
              key={key}
              title={label + '：' + value.value + (value.unit ? ' ' + value.unit : '')}
            >
              <span>{label}</span>
              <strong data-monitor={key}>{value.value}</strong>
              <small data-monitor-unit={key} hidden={!value.unit}>
                {value.unit}
              </small>
            </div>
          );
        })}
      </>
    </div>
  );
}
