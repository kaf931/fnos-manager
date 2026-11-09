import type { IconEntry } from '../backend/domain/icons.js';
import { CardAction } from './card-actions.js';
import { menuTitles } from './navigation.js';
import { AppIcon, icon } from './ui/icon-markup.js';
export type IconCardAction = 'apply' | 'edit' | 'delete' | 'package';
export type IconInstallStatus = 'installing' | 'retry';
export function IconCards({
  entries,
  base,
  installing,
  onAction,
}: {
  entries: IconEntry[];
  base: string;
  installing: ReadonlyMap<string, IconInstallStatus>;
  onAction: (action: IconCardAction, entry: IconEntry) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const status = installing.get(entry.id);
        return (
          <article className="card" key={entry.id}>
            <div className="card-main">
              <img src={`${base}/entries/${entry.id}/icon?v=${entry.revision}`} alt="" />
              <div className="card-info">
                <h3 title={entry.name}>{entry.name}</h3>
                <div className="card-url" title={entry.url}>
                  {entry.menuPage ? menuTitles[entry.menuPage] : entry.url}
                </div>
              </div>
            </div>
            <div className="card-meta">
              <span className="tag">
                <AppIcon name={entry.containerId ? 'docker' : 'link'} />
                {entry.menuPage ? 'NAS 管家' : entry.containerId ? 'Docker 应用' : '自定义链接'}
              </span>
              <span className={entry.appliedRevision === entry.revision ? 'applied' : ''}>
                {entry.appliedRevision === entry.revision
                  ? '已添加到桌面'
                  : entry.appliedRevision
                    ? '待更新到桌面'
                    : '待添加到桌面'}
              </span>
            </div>
            <div className="card-actions">
              <button
                type="button"
                className="apply"
                data-action="apply"
                data-id={entry.id}
                disabled={status === 'installing'}
                onClick={() => onAction('apply', entry)}
              >
                {status === 'installing' ? (
                  '正在安装…'
                ) : status === 'retry' ? (
                  '重试添加'
                ) : entry.appliedRevision ? (
                  '更新到桌面'
                ) : (
                  <>
                    <AppIcon name="plus" />
                    添加到桌面
                  </>
                )}
              </button>
              <span className="card-icon-actions" data-card-actions={entry.id}>
                <span className="card-inline-actions">
                  {(
                    [
                      ['package', '下载入口安装包', 'download'],
                      ['edit', '编辑图标', 'edit'],
                      ['delete', '删除图标', 'trash'],
                    ] as const
                  ).map(([action, label, glyph]) => (
                    <CardAction
                      key={action}
                      action={action}
                      label={label}
                      glyph={glyph}
                      id={entry.id}
                      icon={icon}
                      onClick={() => onAction(action, entry)}
                    />
                  ))}
                </span>
              </span>
            </div>
          </article>
        );
      })}
    </>
  );
}
