export { menuTitles } from './menu-definitions.js';
import { menuTitles } from './menu-definitions.js';
export function mobileNavigationIndex(page: string, moreOpen = false) {
  return moreOpen ? 4 : Math.max(0, Math.min(4, Object.keys(menuTitles).indexOf(page)));
}
