/** Automatic activation for a horizontal ARIA tab list; close buttons stay independent. */
export function navigateTabs(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  current: HTMLButtonElement,
) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(
    current
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)') ?? [],
  );
  const index = tabs.indexOf(current);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
  tabs[next].click();
  tabs[next].focus();
}
