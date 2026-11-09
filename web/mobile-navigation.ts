export function keyboardShrinksViewport({
  mobile,
  editable,
  wasOpen,
  baseline,
  height,
  scale = 1,
}: {
  mobile: boolean;
  editable: boolean;
  wasOpen: boolean;
  baseline: number;
  height: number;
  scale?: number;
}) {
  return (
    mobile &&
    Math.abs(scale - 1) < 0.02 &&
    (editable || wasOpen) &&
    baseline - height > Math.max(120, baseline * 0.18)
  );
}
// Only toggle navigation visibility. Never move/focus inputs or apply keyboard insets.
export function setupMobileNavigation() {
  const root = document.documentElement,
    vv = window.visualViewport,
    media = matchMedia('(max-width:620px)');
  let baseline = Math.max(window.innerHeight, vv?.height || 0),
    width = window.innerWidth,
    open = false,
    frame = 0;
  function update() {
    frame = 0;
    const height = Math.min(window.innerHeight, vv?.height || window.innerHeight),
      focus = document.activeElement;
    const editable = !!focus?.matches(
      'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable=true]',
    );
    if (Math.abs(window.innerWidth - width) > 80) {
      width = window.innerWidth;
      baseline = Math.max(window.innerHeight, height);
      open = false;
    }
    if (!editable && !open) baseline = Math.max(baseline, window.innerHeight, height);
    open = keyboardShrinksViewport({
      mobile: media.matches,
      editable,
      wasOpen: open,
      baseline,
      height,
      scale: vv?.scale || 1,
    });
    root.classList.toggle('mobile-keyboard-open', open);
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  vv?.addEventListener('resize', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  media.addEventListener('change', schedule);
  return () => {
    cancelAnimationFrame(frame);
    vv?.removeEventListener('resize', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    media.removeEventListener('change', schedule);
    root.classList.remove('mobile-keyboard-open');
  };
}
