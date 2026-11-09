interface CardRow {
  id: string;
  name: string;
  username?: string;
  host?: string;
  port?: number;
  kind?: string;
  hasCredentials?: boolean;
  authMethod?: string;
  selected?: boolean;
  busy?: boolean;
}
export interface ConnectionCardOptions<T extends CardRow> {
  description?: (row: T) => string;
  tag?: (row: T) => string;
  meta?: (row: T) => string;
  metaTitle?: (row: T) => string;
  metaControl?: (row: T) => React.ReactNode;
  icon?: React.ReactNode;
  actionLabel?: string | ((row: T) => string);
  busyLabel?: string;
  editLabel?: string;
  deleteLabel?: string;
  moreMenu?: boolean;
  iconPath?: string | ((row: T) => string);
  selectionMode?: () => boolean;
  selectionDisabled?: () => boolean;
  onSelection?: (row: T, selected: boolean) => void;
  extraActions?: (row: T) => [string, string, string][];
}
import Checkbox from '@douyinfe/semi-ui/lib/es/checkbox';
import { CardAction } from './card-actions.js';
import React from 'react';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';
import { MobileMoreButton } from './mobile-more-button.js';
const actionPaths: Record<string, string> = {
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  refresh: 'M20 10a8 8 0 1 0-2 8M20 4v6h-6',
  edit: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15v5Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
};
const actionIcon = (glyph: string) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="${actionPaths[glyph]}"/></svg>`;
export function ConnectionCards<T extends CardRow>({
  rows,
  onAction,
  options = {},
}: {
  rows: T[];
  onAction: (action: string, row: T) => void;
  options?: ConnectionCardOptions<T>;
}) {
  const description = options.description || ((c) => `${c.username}@${c.host}:${c.port}`),
    tag = options.tag || ((c) => (c.kind === 'local' ? 'NAS 本机' : '远程主机')),
    meta =
      options.meta ||
      ((c) =>
        c.hasCredentials
          ? c.authMethod === 'privateKey'
            ? '私钥认证'
            : '密码认证'
          : '待设置认证'),
    actionLabel = options.actionLabel || '连接终端',
    editLabel = options.editLabel || '编辑连接',
    deleteLabel = options.deleteLabel || '删除连接';
  return (
    <>
      {rows.map((c) => (
        <article
          className={`card terminal-card${options.moreMenu ? ' connection-menu-card' : ''}`}
          key={c.id}
        >
          <div className="card-main">
            {options.selectionMode?.() && (
              <Checkbox
                aria-label={'选择 ' + c.name}
                checked={!!c.selected}
                disabled={!!options.selectionDisabled?.()}
                onChange={(e) => options.onSelection?.(c, e.target.checked ?? false)}
              />
            )}
            <span className="terminal-card-icon" aria-hidden="true">
              {options.icon || (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  <path
                    d={
                      (typeof options.iconPath === 'function'
                        ? options.iconPath(c)
                        : options.iconPath) || 'm5 6 6 6-6 6M13 18h6'
                    }
                  />
                </svg>
              )}
            </span>
            <div className="card-info">
              <h3 title={c.name}>{c.name}</h3>
              <div className="card-url" title={description(c)}>
                {description(c)}
              </div>
            </div>
          </div>
          {options.moreMenu && (options.extraActions?.(c) || []).length > 0 && (
            <div className="terminal-card-more">
              <Dropdown
                trigger="click"
                position="bottomRight"
                render={
                  <Dropdown.Menu>
                    {(options.extraActions?.(c) || []).map(([action, label]) => (
                      <Dropdown.Item
                        key={action}
                        type={action === 'delete' ? 'danger' : undefined}
                        onClick={() => onAction(action, c)}
                      >
                        {label}
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                }
              >
                <MobileMoreButton aria-label={c.name + '的更多操作'} />
              </Dropdown>
            </div>
          )}
          <div className="card-meta">
            <span className="tag">{tag(c)}</span>
            <span title={options.metaTitle?.(c)}>{options.metaControl?.(c) ?? meta(c)}</span>
          </div>
          <div className="card-actions">
            <button className="apply" disabled={!!c.busy} onClick={() => onAction('connect', c)}>
              {c.busy
                ? options.busyLabel || '连接中…'
                : typeof actionLabel === 'function'
                  ? actionLabel(c)
                  : actionLabel}
            </button>
            <span className="card-icon-actions">
              {[
                ...(options.extraActions?.(c) || []),
                ['edit', editLabel, 'edit'] as [string, string, string],
                ['delete', deleteLabel, 'trash'] as [string, string, string],
              ].map(([action, label, glyph]) => (
                <CardAction
                  key={action}
                  action={action}
                  label={label}
                  glyph={glyph}
                  icon={actionIcon}
                  className={
                    options.moreMenu && ['shutdown', 'reboot'].includes(action)
                      ? 'mobile-power-action'
                      : undefined
                  }
                  onClick={() => onAction(action, c)}
                />
              ))}
            </span>
          </div>
        </article>
      ))}
    </>
  );
}
