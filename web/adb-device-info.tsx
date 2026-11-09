import { useState } from 'react';
import { DetailRow, DetailSection } from './ui/detail-section.js';
import { deviceInfoGroups } from './adb-device-info-model.js';

export function AdbDeviceInfo({
  properties,
  loading,
  error,
}: {
  properties: Record<string, string>;
  loading: boolean;
  error: string;
}) {
  const [search, setSearch] = useState('');
  const groups = deviceInfoGroups(properties),
    query = search.trim().toLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !query || `${group.title} ${item.label} ${item.value}`.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.items.length);
  return (
    <div className="terminal-monitor-body">
      {loading ? (
        <p className="help" role="status">
          正在读取设备信息…
        </p>
      ) : error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <>
          {!!groups.length && (
            <input
              className="form-input"
              type="search"
              aria-label="搜索设备信息"
              placeholder="搜索设备信息"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {visible.map((group) => (
            <DetailSection
              key={`${group.title}:${query}`}
              title={group.title}
              collapsible
              defaultOpen={!!query || ['设备', '系统', '硬件'].includes(group.title)}
            >
              {group.items.map((item) => (
                <DetailRow key={item.label} {...item} />
              ))}
            </DetailSection>
          ))}
          {!groups.length && (
            <p className="help" role="status">
              暂无可识别的设备信息
            </p>
          )}
          {!!groups.length && !visible.length && (
            <p className="help" role="status">
              没有匹配的设备信息
            </p>
          )}
        </>
      )}
    </div>
  );
}
