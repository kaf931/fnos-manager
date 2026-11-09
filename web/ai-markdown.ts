import { Marked } from 'marked';
import createDOMPurify, { type DOMPurify, type WindowLike } from 'dompurify';
const markdown = new Marked({ gfm: true, breaks: true });
const sanitizers = new WeakMap<WindowLike, DOMPurify>();
export function renderAiMarkdown(text: string, window: WindowLike = globalThis.window) {
  let purifier = sanitizers.get(window);
  if (!purifier) {
    purifier = createDOMPurify(window);
    sanitizers.set(window, purifier);
  }
  const html = purifier.sanitize(
    markdown.parse(text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, ''), { async: false }),
    {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'em',
        'del',
        's',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'blockquote',
        'pre',
        'code',
        'a',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'hr',
      ],
      ALLOWED_ATTR: ['href', 'title', 'start'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    },
  );
  if (!window.document) throw new Error('Markdown rendering requires a document');
  const template = window.document.createElement('template');
  template.innerHTML = html;
  for (const a of template.content.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) a.removeAttribute('href');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return template.innerHTML;
}
