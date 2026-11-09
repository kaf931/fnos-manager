import React, { useLayoutEffect, useRef } from 'react';

/** Keep metadata still while an overflowing name moves slowly within its own column. */
export function AutoScrollName({ children, title }: { children: React.ReactNode; title?: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = viewport.current!,
      text = content.current!;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined,
      visible = true,
      interacting = false;
    const sync = () => {
      if (!animation) return;
      if (visible && !interacting && !document.hidden) {
        host.scrollLeft = 0;
        animation.play();
      } else animation.pause();
    };
    const measure = () => {
      animation?.cancel();
      animation = undefined;
      const distance = text.scrollWidth - host.clientWidth;
      if (distance <= 1 || !host.clientWidth || motion.matches || !text.animate) return;
      const travel = (distance / 24) * 1000,
        duration = travel * 2 + 2400;
      const pause = 1200 / duration;
      animation = text.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: pause },
          { transform: `translateX(-${distance}px)`, offset: 0.5 },
          { transform: `translateX(-${distance}px)`, offset: 0.5 + pause },
          { transform: 'translateX(0)', offset: 1 },
        ],
        { duration, iterations: Infinity, easing: 'linear' },
      );
      sync();
    };
    const pause = () => {
      interacting = true;
      sync();
    };
    const resume = () => {
      interacting = host.matches(':hover') || host.contains(document.activeElement);
      sync();
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(host);
    resize?.observe(text);
    const intersection =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
          });
    intersection?.observe(host);
    host.addEventListener('pointerenter', pause);
    host.addEventListener('pointerleave', resume);
    host.addEventListener('focusin', pause);
    host.addEventListener('focusout', resume);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', measure);
    measure();
    return () => {
      animation?.cancel();
      resize?.disconnect();
      intersection?.disconnect();
      host.removeEventListener('pointerenter', pause);
      host.removeEventListener('pointerleave', resume);
      host.removeEventListener('focusin', pause);
      host.removeEventListener('focusout', resume);
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', measure);
    };
  }, [children]);
  return (
    <span className="history-compact-name" ref={viewport} tabIndex={0} title={title}>
      <span className="history-compact-name-content" ref={content}>
        {children}
      </span>
    </span>
  );
}
