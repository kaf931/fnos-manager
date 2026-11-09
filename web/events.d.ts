import type { PageId } from './menu-definitions.js';
declare global {
  interface WindowEventMap {
    'deskicons:pagechange': CustomEvent<{ page: PageId; title?: string }>;
    'deskicons:terminalstate': CustomEvent<{ active: boolean }>;
    'deskicons:aiproviderschange': Event;
    'deskicons:configrestored': Event;
  }
}
export {};
