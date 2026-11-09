import type { ContainerSummary } from '../backend/domain/docker.js';
import { AppIcon } from './ui/icon-markup.js';
export interface ContainerListProps {
  containers: ContainerSummary[];
  selectedId?: string;
  icons: ReadonlyMap<string, string>;
  loading?: boolean;
  error?: string;
  onSelect: (id: string) => void;
  onIconError: (id: string) => void;
}
export function ContainerList({
  containers,
  selectedId,
  icons,
  loading = false,
  error = '',
  onSelect,
  onIconError,
}: ContainerListProps) {
  if (loading) return <p className="container-note">正在读取 Docker 应用…</p>;
  if (error)
    return (
      <p className="container-note">
        {error}
        <br />
        也可以选择“自定义链接”手动添加。
      </p>
    );
  if (!containers.length) return <p className="container-note">没有找到匹配的容器</p>;
  return (
    <>
      {containers.map((container) => {
        const image = icons.get(container.id);
        return (
          <button
            key={container.id}
            type="button"
            className={'container-item ' + (selectedId === container.id ? 'selected' : '')}
            data-container={container.id}
            onClick={() => onSelect(container.id)}
          >
            <span className={'container-icon ' + (image ? 'has-image' : '')}>
              <AppIcon name="docker" />
              <img
                data-container-icon={container.id}
                src={image}
                alt=""
                hidden={!image}
                onError={() => onIconError(container.id)}
              />
            </span>
            <div>
              <strong title={container.name}>{container.name}</strong>
              <small>
                {container.state === 'running' ? '运行中' : '未运行'} ·{' '}
                {container.ports.length
                  ? [...new Set(container.ports.map((port) => port.hostPort))].join(' / ')
                  : '无映射端口'}
              </small>
            </div>
          </button>
        );
      })}
    </>
  );
}
