import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from './icon-markup.js';

/** A bounded horizontal collection; cards keep their size on narrow screens. */
export function CompactCardStrip({
  children,
  label = '卡片',
}: {
  children: ReactNode;
  label?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [canRight, setCanRight] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  function measure() {
    const element = viewport.current;
    if (element) {
      setCanLeft(element.scrollLeft > 1);
      setCanRight(element.scrollWidth - element.clientWidth - element.scrollLeft > 1);
    }
  }
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    measure();
    const Observer = element.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer && new Observer(measure);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    // React delegates wheel events passively; use one scoped non-passive listener so
    // the page only stays still when this row can consume the vertical wheel delta.
    const host = element.parentElement!;
    const wheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        !event.cancelable ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.deltaX ||
        !event.deltaY
      )
        return;
      const unit =
        event.deltaMode === 1
          ? parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).lineHeight) ||
            16
          : event.deltaMode === 2
            ? element.clientWidth
            : 1;
      const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
      const target = Math.max(0, Math.min(maximum, element.scrollLeft + event.deltaY * unit));
      const movement = target - element.scrollLeft;
      if (Math.abs(movement) < 0.5) return;
      event.preventDefault();
      element.scrollBy({ left: movement, behavior: 'auto' });
    };
    host.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer?.disconnect();
      host.removeEventListener('wheel', wheel);
    };
  }, [children]);
  function scroll(direction: number) {
    const element = viewport.current;
    if (!element) return;
    const reduced = element.ownerDocument.defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    element.scrollBy({
      left: direction * Math.max(1, element.clientWidth * 0.85),
      behavior: reduced ? 'auto' : 'smooth',
    });
  }
  return (
    <div className="compact-card-strip-shell">
      <button
        type="button"
        className="icon-button compact-card-strip-previous"
        hidden={!canLeft}
        aria-label={'向左查看更多' + label}
        title={'向左查看更多' + label}
        onClick={() => scroll(-1)}
      >
        <AppIcon name="triangle-left" />
      </button>
      <div
        ref={viewport}
        className="compact-card-strip"
        data-scroll-inset
        onScroll={measure}
      >
        {children}
      </div>
      <button
        type="button"
        className="icon-button compact-card-strip-next"
        hidden={!canRight}
        aria-label={'向右查看更多' + label}
        title={'向右查看更多' + label}
        onClick={() => scroll(1)}
      >
        <AppIcon name="triangle-right" />
      </button>
    </div>
  );
}

export function CompactCard({
  title,
  description,
  icon,
  control,
  actions,
  onOpen,
  disabled,
  openLabel = '编辑 ' + title,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  control?: ReactNode;
  actions?: ReactNode;
  onOpen: () => void;
  disabled?: boolean;
  openLabel?: string;
}) {
  return (
    <article className="card compact-card">
      <button
        type="button"
        className="compact-card-open"
        aria-label={openLabel}
        title={openLabel}
        onClick={onOpen}
        disabled={disabled}
      >
        <span className="terminal-card-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="card-info">
          <strong title={title}>{title}</strong>
          <span className="card-url">{description}</span>
        </span>
      </button>
      <div className="compact-card-controls">
        {control}
        {actions}
      </div>
    </article>
  );
}
