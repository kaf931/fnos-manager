// One delegated listener covers current and dynamically mounted scroll surfaces.
export function createScrollActivity({
  delay = 250,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  delay?: number;
  setTimer?: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout> | undefined) => void;
} = {}) {
  const pending = new Map<Element, ReturnType<typeof setTimeout>>();
  function clear(element: Element) {
    if (pending.has(element)) clearTimer(pending.get(element));
    pending.delete(element);
    element.classList.remove('scrollbar-scrolling');
  }
  return {
    pulse(element: Element | null | undefined) {
      if (!element?.classList) return;
      if (pending.has(element)) clearTimer(pending.get(element));
      element.classList.add('scrollbar-scrolling');
      pending.set(
        element,
        setTimer(() => clear(element), delay),
      );
    },
    clear,
    dispose() {
      for (const element of pending.keys()) clear(element);
    },
  };
}
const activity = createScrollActivity();
export const showScrollActivity = (element: Element | null | undefined) => activity.pulse(element);
export const clearScrollActivity = (element: Element) => activity.clear(element);
export function syncScrollInset(element: HTMLElement) {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  for (const [outer, inner, edges, property] of [
    [
      'offsetWidth',
      'clientWidth',
      ['borderLeftWidth', 'borderRightWidth'],
      '--app-scrollbar-gutter',
    ],
    [
      'offsetHeight',
      'clientHeight',
      ['borderTopWidth', 'borderBottomWidth'],
      '--app-scrollbar-horizontal-gutter',
    ],
  ] as const) {
    const border = edges.reduce((sum, edge) => sum + (parseFloat(style[edge]) || 0), 0);
    const gutter = Math.max(0, element[outer] - element[inner] - border) + 'px';
    if (element.style.getPropertyValue(property) !== gutter)
      element.style.setProperty(property, gutter);
  }
}
export function observeScrollInsets(elements: Iterable<HTMLElement>) {
  const surfaces = Array.from(elements);
  const Observer = surfaces[0]?.ownerDocument.defaultView?.ResizeObserver;
  // Content-box changes also catch scrollbars appearing after list rendering.
  const observer =
    Observer &&
    new Observer((entries) =>
      entries.forEach(({ target }) => syncScrollInset(target as HTMLElement)),
    );
  surfaces.forEach((element) => {
    syncScrollInset(element);
    observer?.observe(element);
  });
  return () => observer?.disconnect();
}
export function setupSharedScrollbars(root: Document = document, controller = activity) {
  const scrolled = (event: Event) => {
    const target = event.target === root ? root.scrollingElement : event.target;
    if (target instanceof root.defaultView!.Element) controller.pulse(target);
  };
  root.addEventListener('scroll', scrolled, { capture: true, passive: true });
  const surfaces = new Set<HTMLElement>();
  const Observer = root.defaultView?.ResizeObserver;
  const observer =
    Observer &&
    new Observer((entries) => {
      entries.forEach(({ target }) => syncScrollInset(target as HTMLElement));
    });
  const sync = () => {
    const current = new Set(root.querySelectorAll<HTMLElement>('[data-scroll-inset]'));
    for (const element of surfaces) {
      if (!current.has(element)) {
        observer?.unobserve(element);
        surfaces.delete(element);
      }
    }
    for (const element of current) {
      if (!surfaces.has(element)) {
        surfaces.add(element);
        syncScrollInset(element);
        observer?.observe(element);
      }
    }
  };
  sync();
  const Mutation = root.defaultView?.MutationObserver;
  const mutation = Mutation && new Mutation(sync);
  mutation?.observe(root.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-scroll-inset'],
  });
  return () => {
    root.removeEventListener('scroll', scrolled, true);
    mutation?.disconnect();
    observer?.disconnect();
    surfaces.clear();
  };
}
