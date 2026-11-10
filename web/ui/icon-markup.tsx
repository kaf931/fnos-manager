import { navigationIcon, bellIcon } from '../navigation-icons.js';

const paths: Readonly<Record<string, string>> = {
  bell: bellIcon,
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
  ai: '<path d="m10 3 2.3 6.7L19 12l-6.7 2.3L10 21l-2.3-6.7L1 12l6.7-2.3L10 3Zm10-1 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z"/>',
  transfers: '<path d="M7 3v16m-4-4 4 4 4-4M17 21V5m-4 4 4-4 4 4"/>',
  library:
    '<path d="M4 3h12a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Zm0 15a3 3 0 0 1 3-3h12M8 7l2 2-2 2m5 0h3"/>',
  monitor: '<path d="M3 4h18v13H3zM5 11l3-3 4 6 3-4h4M8 21h8m-4-4v4"/>',

  compare:
    '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M6 8h1m-1 4h1m10-4h1m-1 4h1"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  move: '<path d="M12 2v20M2 12h20m-13-7 3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>',
  clipboard:
    '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="3" width="8" height="4" rx="1"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  settings:
    '<path d="m9 3 1-1h4l1 1 .5 2 2 .8 1.9-.5 2 3.4-.6 1.9L20 12l.8 1.4.6 1.9-2 3.4-1.9-.5-2 .8L15 21l-1 1h-4l-1-1-.5-2-2-.8-1.9.5-2-3.4.6-1.9L4 12l-.8-1.4-.6-1.9 2-3.4 1.9.5 2-.8L9 3Z"/><circle cx="12" cy="12" r="3"/>',
  power: '<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'triangle-right': '<path d="m8 5 10 7-10 7Z" fill="currentColor" stroke="none"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  storage:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/>',
  folder: '<path d="M3 6h7l2 2h9v12H3z"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/>',
  terminal: '<path d="m5 6 6 6-6 6M13 18h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  docker:
    '<path d="M3 11h15c1 0 2-1 3-2 1 6-3 11-9 11-5 0-8-3-9-9Z"/><path d="M5 7h4v4H5zm4 0h4v4H9zm4 0h4v4h-4zM9 3h4v4H9z"/>',
  link: '<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01m3 0h.01"/>',
  external:
    '<path d="M14 3h7v7m0-7L11 13m-1-9H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v4h18v-4"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15v5Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4"/>',
};
export const icon = (n: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n] || paths.grid}</svg>`;

/** Artwork comes only from the local static icon catalogue. */
export function AppIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] || paths.grid }}
    />
  );
}
export function NavigationArtwork({ page }: { page: string }) {
  const markup = navigationIcon(page)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  return (
    <svg
      className="nav-symbol"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
