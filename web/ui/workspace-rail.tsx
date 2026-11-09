import { useEffect, useLayoutEffect, useId, useRef, useState, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/** Shared geometry stays in CSS. Native delegation also reaches React portal controls. */
export function WorkspaceRail({
  as: Tag = 'nav',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'nav' | 'div' }) {
  const rail = useRef<HTMLElement | null>(null);
  const id = useId();
  const [tip, setTip] = useState<{
    label: string;
    left: number;
    right: number;
    top: number;
  } | null>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!tip || !tooltip.current) return;
    const { width, height } = tooltip.current.getBoundingClientRect();
    setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
  }, [tip]);
  useEffect(() => {
    const host = rail.current;
    if (!host) return;
    const show = (event: Event) => {
      if ('pointerType' in event && event.pointerType === 'touch') return;
      const button = event.target instanceof window.Element ? event.target.closest('button') : null;
      const label = button?.getAttribute('aria-label');
      if (!button || !label) return setTip(null);
      const rect = button.getBoundingClientRect();
      setTip({ label, left: rect.left, right: rect.right, top: rect.top + rect.height / 2 });
    };
    const close = () => setTip(null);
    const leave = (event: PointerEvent) => {
      if (
        !(event.relatedTarget instanceof window.Element) ||
        event.relatedTarget.closest('button') !== (event.target as Element).closest('button')
      )
        close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    host.addEventListener('pointerover', show);
    host.addEventListener('pointerout', leave);
    host.addEventListener('focusin', show);
    host.addEventListener('focusout', close);
    host.addEventListener('pointerdown', close);
    host.addEventListener('scroll', close, true);
    host.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('fullscreenchange', close);
    return () => {
      host.removeEventListener('pointerover', show);
      host.removeEventListener('pointerout', leave);
      host.removeEventListener('focusin', show);
      host.removeEventListener('focusout', close);
      host.removeEventListener('pointerdown', close);
      host.removeEventListener('scroll', close, true);
      host.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('fullscreenchange', close);
    };
  }, []);
  return (
    <>
      <Tag
        {...props}
        ref={(element) => {
          rail.current = element;
        }}
      >
        {children}
      </Tag>
      {tip &&
        createPortal(
          <span
            ref={tooltip}
            id={id}
            className="workspace-rail-tooltip"
            role="tooltip"
            style={{
              left: Math.max(
                8,
                Math.min(
                  tip.right + 8 + size.width <= window.innerWidth - 8
                    ? tip.right + 8
                    : tip.left - 8 - size.width,
                  window.innerWidth - size.width - 8,
                ),
              ),
              top: Math.max(
                size.height / 2 + 8,
                Math.min(tip.top, window.innerHeight - size.height / 2 - 8),
              ),
            }}
          >
            {tip.label}
          </span>,
          document.fullscreenElement || document.body,
        )}
    </>
  );
}
