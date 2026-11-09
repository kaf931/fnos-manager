import { menuPages, type MenuPage } from '../../domain/icons.js';

export function standalonePage(url: string): MenuPage | null {
  const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const page = query.get('page');
  return query.getAll('page').length === 1 &&
    query.get('standalone') === '1' &&
    menuPages.includes(page as MenuPage)
    ? (page as MenuPage)
    : null;
}

// Persist launch state on the document before React mounts the selected feature.
export function standaloneDocument(html: string, page: MenuPage): string {
  return html.replace('<html ', `<html class="standalone-entry" data-initial-page="${page}" `);
}
