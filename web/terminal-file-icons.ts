import React from 'react';
const h = React.createElement;
const shapes: Record<string, string> = {
  back: 'M15 5 6 12l9 7z',
  forward: 'M9 5l9 7-9 7z',
  calculate:
    'M5 3h14v18H5zM8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  up: 'm6 14 6-6 6 6',
  refresh: 'M20 10a8 8 0 1 0-2 8M20 4v6h-6',
  upload: 'M12 16V3m-5 5 5-5 5 5M3 16v4h18v-4',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  file: 'M14 3H5v18h14V8zM14 3v5h5',
  folder: 'M3 6h7l2 2h9v12H3z',
  link: 'm10 14 4-4m-7 5-2 2a4 4 0 0 1-4-6l4-4m12 2 2-2a4 4 0 0 0-4-6l-4 4',
};
export const icon = (n: string) =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    h('path', {
      d: shapes[n] || shapes.file,
      ...(['back', 'forward'].includes(n) ? { fill: 'currentColor', stroke: 'none' } : {}),
    }),
  );
