import type { Terminal } from '@xterm/xterm';

/** Both terminal protocols follow the shared appearance tokens and live changes. */
export function bindTerminalTheme(terminal: Terminal): () => void {
  const update = () => {
    const colors = getComputedStyle(document.body);
    terminal.options.theme = {
      background: colors.getPropertyValue('--terminal-bg').trim(),
      foreground: colors.getPropertyValue('--terminal-foreground').trim(),
      cursor: colors.getPropertyValue('--blue').trim(),
      selectionBackground: colors.getPropertyValue('--blue-soft').trim(),
    };
  };
  const observer = new window.MutationObserver(update);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['theme-mode', 'data-palette', 'data-terminal-background'],
  });
  update();
  return () => observer.disconnect();
}
