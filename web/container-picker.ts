import type { ContainerSummary } from '../backend/domain/docker.js';
export interface ContainerPickerState {
  containers?: ContainerSummary[];
  selected?: ContainerSummary | null;
  icons: ReadonlyMap<string, string>;
  loading?: boolean;
  error?: string;
}
import React from 'react';
const h = React.createElement;

const label = (c: ContainerSummary, icons: ReadonlyMap<string, string>, detail = false) =>
  h(
    'span',
    { className: 'container-picker-option' },
    icons.has(c.id)
      ? h('img', {
          src: icons.get(c.id),
          alt: '',
        })
      : h(
          'span',
          { className: 'container-picker-fallback', 'aria-hidden': true },
          h(
            'svg',
            { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
            h('path', {
              d: 'M3 11h15c1 0 2-1 3-2 1 6-3 11-9 11-5 0-8-3-9-9Z M5 7h4v4H5zm4 0h4v4H9zm4 0h4v4h-4zM9 3h4v4H9z',
            }),
          ),
        ),
    h(
      'span',
      { className: 'container-picker-text' },
      h('span', null, c.name),
      detail &&
        h(
          'small',
          null,
          `${c.state === 'running' ? '运行中' : '未运行'} · ${c.ports.length ? [...new Set(c.ports.map((p) => p.hostPort))].join(' / ') : '无映射端口'}`,
        ),
    ),
  );
export function ContainerPicker({
  containers = [],
  selected,
  icons,
  loading = false,
  error = '',
  onChange,
}: ContainerPickerState & { onChange: (id: string) => void }) {
  const [query, setQuery] = React.useState(''),
    details = React.useRef<HTMLDetailsElement>(null);
  const shown = containers.filter((c) =>
    `${c.name} ${c.image}`.toLowerCase().includes(query.toLowerCase()),
  );
  const placeholder = loading
    ? '正在读取 Docker 应用…'
    : error
      ? '暂时无法读取'
      : containers.length
        ? '请选择 Docker 应用'
        : '没有可选的 Docker 应用';
  return h(
    'details',
    { className: 'inline-container-picker', ref: details },
    h(
      'summary',
      {
        'aria-label': '选择 Docker 应用',
        'aria-disabled': loading || !containers.length,
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          if (loading || !containers.length) e.preventDefault();
        },
      },
      selected
        ? label(selected, icons)
        : h('span', { className: 'picker-placeholder' }, placeholder),
      h(
        'svg',
        {
          'aria-hidden': true,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
        },
        h('path', { d: 'm5 7 5 5 5-5' }),
      ),
    ),
    h(
      'div',
      { className: 'inline-container-options' },
      h(
        'label',
        { className: 'search inline-container-search' },
        h(
          'svg',
          {
            'aria-hidden': true,
            viewBox: '0 0 20 20',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
          },
          h('circle', { cx: 8, cy: 8, r: 5 }),
          h('path', { d: 'm12 12 5 5' }),
        ),
        h('input', {
          type: 'search',
          'aria-label': '搜索 Docker 应用',
          placeholder: '搜索应用名称或镜像',
          value: query,
          onChange: (e) => setQuery(e.target.value),
        }),
      ),
      h(
        'div',
        { role: 'listbox', 'aria-label': 'Docker 应用' },
        shown.length
          ? shown.map((c) =>
              h(
                'button',
                {
                  key: c.id,
                  type: 'button',
                  role: 'option',
                  'aria-selected': selected?.id === c.id,
                  className: 'inline-container-option',
                  onClick: () => {
                    if (details.current) details.current.open = false;
                    setQuery('');
                    onChange(c.id);
                  },
                },
                label(c, icons, true),
              ),
            )
          : h('p', { className: 'container-note' }, '没有匹配的应用'),
      ),
    ),
  );
}
