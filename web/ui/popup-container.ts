/** Keep portals inside the native dialog or fullscreen top layer that owns the trigger. */
export function resolvePopupContainer(trigger: Element | null): HTMLElement {
  return (
    trigger?.closest('dialog') ||
    (document.fullscreenElement as HTMLElement | null) ||
    document.body
  );
}
