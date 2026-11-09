import type {
  FileListing as ListingData,
  FileSort,
  DirectorySize,
  PositionedFileContext,
  SessionIdentity,
  FileEntry,
  LoadDirectory,
} from './contracts/terminal.js';
import type { FileContextEvent, PressState } from './terminal-file-interactions.js';
import React from 'react';
import { icon } from './terminal-file-icons.js';
import {
  sortEntries,
  joinPath,
  shouldOpenEntry,
  formatSize,
  formatFileTime,
} from './terminal-file-model.js';
const h = React.createElement,
  types = { directory: '文件夹', file: '文件', link: '符号链接', other: '其他' };

export function FileListing({
  data,
  sizes,
  sort,
  setSort,
  calculating,
  context,
  showContext,
  touchStart,
  longPress,
  lastPointer,
  load,
  session,
  calculate,
  loading,
  clearPress,
  press,
  setContext,
}: {
  data: ListingData | null;
  sizes: Record<string, DirectorySize>;
  sort: FileSort;
  setSort: (sort: FileSort) => void;
  calculating: string | null;
  context: PositionedFileContext | null;
  showContext: (event: FileContextEvent, entry: FileEntry | null) => void;
  touchStart: (event: FileContextEvent & { pointerType: string }, entry: FileEntry | null) => void;
  longPress: React.MutableRefObject<boolean>;
  lastPointer: React.MutableRefObject<string>;
  load: LoadDirectory;
  session: SessionIdentity;
  calculate?: (entry: FileEntry) => Promise<void>;
  loading: boolean;
  clearPress: () => void;
  press: React.MutableRefObject<PressState | null>;
  setContext: (context: PositionedFileContext | null) => void;
}) {
  const rows = data
    ? sortEntries(
        data.entries.map((e) =>
          e.type === 'directory' && sizes[joinPath(data.path, e.name)]
            ? { ...e, size: sizes[joinPath(data.path, e.name)].bytes }
            : e,
        ),
        sort.key,
        sort.desc,
      )
    : [];
  const sortBy = (key: FileSort['key']) => () =>
    setSort({ key, desc: sort.key === key ? !sort.desc : false });
  const table = h(
    'table',
    { className: 'terminal-files-table' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        ...(
          [
            ['name', '名称'],
            ['type', '类型'],
            ['size', '大小'],
            ['mtime', '修改时间'],
          ] as const
        ).map(([key, label]) =>
          h(
            'th',
            { key, className: 'file-col-' + key },
            h(
              'button',
              { onClick: sortBy(key) },
              label,
              sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '',
            ),
          ),
        ),
      ),
    ),
    h(
      'tbody',
      null,
      ...rows.map((entry) => {
        const target = joinPath(data!.path, entry.name),
          computed = sizes[target],
          pending = calculating === target;
        return h(
          'tr',
          {
            key: entry.name,
            tabIndex: 0,
            className: context?.entry?.name === entry.name ? 'file-context-selected' : undefined,
            onContextMenu: (e) => showContext(e, entry),
            onPointerDown: (e) => touchStart(e, entry),
            onDoubleClick: (e) => {
              if (
                e.target instanceof document.defaultView!.Element &&
                e.target.closest('.file-size-calculate')
              )
                return;
              if (longPress.current) {
                longPress.current = false;
                return;
              }
              if (shouldOpenEntry(entry.type, 'double-click', lastPointer.current)) load(target);
            },
            onKeyDown: (e) => {
              if (
                e.key === 'Enter' &&
                e.target === e.currentTarget &&
                shouldOpenEntry(entry.type, 'keyboard')
              ) {
                e.preventDefault();
                load(target);
              }
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                const r = e.currentTarget.getBoundingClientRect();
                showContext(
                  {
                    preventDefault: () => e.preventDefault(),
                    stopPropagation: () => e.stopPropagation(),
                    clientX: r.left + 24,
                    clientY: r.bottom,
                  },
                  entry,
                );
              }
            },
          },
          h(
            'td',
            { className: 'file-col-name' },
            h(
              'button',
              {
                className: 'file-entry-name',
                title: entry.name,
                onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                  if (longPress.current) {
                    longPress.current = false;
                    return;
                  }
                  if (
                    shouldOpenEntry(
                      entry.type,
                      e.detail === 0 ? 'keyboard' : 'click',
                      lastPointer.current,
                    )
                  )
                    load(target);
                },
                disabled: !session.connected,
              },
              icon(entry.type === 'directory' ? 'folder' : entry.type === 'link' ? 'link' : 'file'),
              h('span', null, entry.name),
            ),
          ),
          h('td', { className: 'file-col-type' }, types[entry.type]),
          h(
            'td',
            { className: 'file-col-size' },
            entry.type === 'directory'
              ? computed
                ? h(
                    'span',
                    { title: `${computed.files} 个文件，${computed.directories} 个子文件夹` },
                    formatSize(computed.bytes),
                  )
                : calculate
                  ? h(
                      'button',
                      {
                        className:
                          'icon-button file-size-calculate' + (pending ? ' calculating' : ''),
                        title: pending ? '正在计算' : '计算文件夹大小',
                        'aria-label': `计算“${entry.name}”的大小`,
                        onClick: () => calculate(entry),
                        disabled: !!calculating || !session.connected,
                      },
                      icon(pending ? 'refresh' : 'calculate'),
                    )
                  : '—'
              : formatSize(entry.size),
          ),
          h('td', { className: 'file-col-mtime' }, formatFileTime(entry.mtime)),
        );
      }),
    ),
  );
  return h(
    'div',
    {
      className: 'terminal-files-table-wrap',
      'aria-busy': loading,
      'aria-label': '文件列表，右键或长按打开菜单',
      tabIndex: 0,
      onContextMenu: (e) => showContext(e, null),
      onPointerDown: (e) => touchStart(e, null),
      onPointerUp: clearPress,
      onPointerCancel: clearPress,
      onPointerMove: (e) => {
        if (
          press.current &&
          Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8
        )
          clearPress();
      },
      onScroll: () => {
        setContext(null);
        clearPress();
      },
    },
    table,
    !loading &&
      data &&
      !rows.length &&
      h('div', { className: 'terminal-files-message' }, '文件夹为空'),
  );
}
