import { menuTitles, isPageId } from './menu-definitions.js';
/** @param {string} search @param {keyof typeof menuTitles} fallback */
export function resolveMenuEntry(search: string, fallback: keyof typeof menuTitles = 'icons') {
  const params = new URLSearchParams(search);
  const requested = params.get('page');
  const valid = params.getAll('page').length === 1 && requested !== null && isPageId(requested);
  return {
    page: valid ? requested : fallback,
    standalone: valid && params.get('standalone') === '1',
  };
}
