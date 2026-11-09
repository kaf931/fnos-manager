import { useEffect, useRef, useState, type ReactNode } from 'react';
export function PullRefresh({
  children,
  onRefresh,
  onError = () => {},
}: {
  children: ReactNode;
  onRefresh: () => unknown | Promise<unknown>;
  onError?: (error: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ onRefresh, onError });
  latest.current = { onRefresh, onError };
  const [gesture, setGesture] = useState({ distance: 0, busy: false, dragging: false });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let start: { x: number; y: number } | null = null,
      distance = 0,
      busy = false,
      alive = true;
    const reset = () => {
      start = null;
      distance = 0;
      if (alive) setGesture({ distance: 0, busy: false, dragging: false });
    };
    const begin = (event: TouchEvent) => {
      if (busy || !window.matchMedia('(max-width:620px)').matches || event.touches.length !== 1)
        return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest('input,textarea,select,button,[contenteditable=true],[role=slider]')
      )
        return;
      for (
        let node: Element | null = target;
        node && element.contains(node);
        node = node.parentElement
      )
        if (node.scrollTop > 0) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const dx = event.touches[0].clientX - start.x,
        dy = event.touches[0].clientY - start.y;
      if (dy < 0 || (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy))) {
        reset();
        return;
      }
      if (dy < 12 && !distance) return;
      if (event.cancelable) event.preventDefault();
      distance = Math.min(72, Math.max(0, (dy - 12) * 0.5));
      setGesture({ distance, busy: false, dragging: true });
    };
    const end = async () => {
      const ready = !!start && distance >= 52;
      start = null;
      if (!ready) {
        if (!busy) reset();
        return;
      }
      busy = true;
      setGesture({ distance: 44, busy: true, dragging: false });
      try {
        await latest.current.onRefresh();
      } catch (e) {
        if (alive) latest.current.onError(e);
      } finally {
        busy = false;
        reset();
      }
    };
    const cancel = () => {
      if (!busy) reset();
    };
    element.addEventListener('touchstart', begin, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    return () => {
      alive = false;
      element.removeEventListener('touchstart', begin);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
    };
  }, []);
  return (
    <div ref={host} className="pull-refresh-host">
      <div
        className={'pull-refresh-indicator' + (gesture.busy ? ' refreshing' : '')}
        role="status"
        aria-live="polite"
        aria-label={
          gesture.busy
            ? '正在刷新'
            : gesture.distance >= 52
              ? '松开刷新'
              : gesture.distance
                ? '下拉刷新'
                : undefined
        }
        aria-busy={gesture.busy}
        style={{
          transform: `translate3d(0,${gesture.distance / 2 - 22}px,0)`,
          opacity: gesture.distance ? 1 : 0,
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.8}
          strokeLinecap="round"
        >
          <circle cx={12} cy={12} r={9} opacity={0.18} />
          <circle cx={12} cy={12} r={9} strokeDasharray="18 39" />
        </svg>
      </div>
      <div
        className={'pull-refresh-surface' + (gesture.dragging ? ' pull-refresh-dragging' : '')}
        style={{
          transform: gesture.distance ? `translate3d(0,${gesture.distance}px,0)` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
