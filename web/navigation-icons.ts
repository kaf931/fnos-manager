export const bellIcon = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>';
export const messageIcon =
  '<path class="nav-icon-body" d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4V5a2 2 0 0 1 2-2Z"/><path class="nav-icon-detail" d="M8 8h8m-8 5h5"/>';
// Navigation artwork stays vector-based so outline and solid states share geometry.
const artwork = {
  notifications: messageIcon,
  more: '<g class="nav-icon-body"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g>',
  icons:
    '<g class="nav-icon-body"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></g>',
  tasks:
    '<circle class="nav-icon-body" cx="12" cy="12" r="9"/><path class="nav-icon-detail nav-clock-hand" d="M12 7v5l3 2"/>',
  terminal:
    '<rect class="nav-icon-body" x="3" y="4" width="18" height="16" rx="4"/><path class="nav-icon-detail" d="m7 9 3 3-3 3m6 0h4"/>',
  storage:
    '<path class="nav-icon-body" d="M3 5c0-4 18-4 18 0v14c0 4-18 4-18 0Z"/><path class="nav-icon-detail" d="M3 5c0 4 18 4 18 0M3 12c0 4 18 4 18 0"/>',
  wake: '<circle class="nav-icon-body nav-power-disc" stroke="none" cx="12" cy="12" r="10"/><path class="nav-icon-detail" d="M12 4v8M7 7a7 7 0 1 0 10 0"/>',
};
export function navigationIcon(page: string) {
  return `<svg class="nav-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${artwork[page as keyof typeof artwork] || artwork.icons}</svg>`;
}
