export function bindFileMenuDismiss(root: EventTarget, dismiss: () => void) {
  const pointer = (event: Event) => {
      if (!(
        event.target instanceof document.defaultView!.Element &&
        event.target.closest('.terminal-file-context-menu')
      ))
        dismiss();
    },
    key = (event: Event) => {
      if (event instanceof document.defaultView!.KeyboardEvent && event.key === 'Escape') dismiss();
    };
  root.addEventListener('pointerdown', pointer, true);
  root.addEventListener('keydown', key);
  return () => {
    root.removeEventListener('pointerdown', pointer, true);
    root.removeEventListener('keydown', key);
  };
}
