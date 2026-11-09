import { WorkspaceRail } from './ui/workspace-rail.js';
import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { AppIcon } from './ui/icon-markup.js';

/** Fullscreen presentation of the same controls used by the workspace rail. */
export function VncFloatingTools({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const handle = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const moved = useRef(false);
  const place = (left: number, top: number) => {
    const rail = handle.current?.parentElement;
    const parent = rail?.parentElement;
    if (!rail || !parent) return;
    const size = rail.getBoundingClientRect(),
      bounds = parent.getBoundingClientRect();
    const next = {
      left: Math.max(8, Math.min(left, Math.max(8, bounds.width - size.width - 8))),
      top: Math.max(8, Math.min(top, Math.max(8, bounds.height - size.height - 8))),
    };
    setPosition((old) => (old?.left === next.left && old?.top === next.top ? old : next));
  };
  useEffect(() => {
    const rail = handle.current?.parentElement,
      parent = rail?.parentElement;
    if (!rail || !parent) return;
    const clamp = () => {
      const rect = rail.getBoundingClientRect(),
        bounds = parent.getBoundingClientRect();
      place(rect.left - bounds.left, rect.top - bounds.top);
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(rail);
    observer.observe(parent);
    window.addEventListener('resize', clamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', clamp);
    };
  }, []);
  return (
    <WorkspaceRail
      as="div"
      className="vnc-floating-toolbar workspace-rail terminal-workspace-rail"
      style={position ?? undefined}
      role="toolbar"
      aria-label="全屏远程桌面工具栏"
    >
      <button
        ref={handle}
        type="button"
        className="icon-button vnc-floating-handle"
        aria-label={expanded ? '收起工具栏' : '展开工具栏'}
        title={expanded ? '收起工具栏；拖动调整位置' : '展开工具栏；拖动调整位置'}
        aria-expanded={expanded}
        aria-controls={expanded ? 'vnc-fullscreen-tools' : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          const rail = event.currentTarget.parentElement!,
            parent = rail.parentElement!;
          const rect = rail.getBoundingClientRect(),
            bounds = parent.getBoundingClientRect();
          moved.current = false;
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: rect.left - bounds.left,
            top: rect.top - bounds.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.stopPropagation();
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (!moved.current && Math.hypot(dx, dy) < 5) return;
          moved.current = true;
          place(start.left + dx, start.top + dy);
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          event.stopPropagation();
        }}
        onPointerCancel={() => {
          drag.current = null;
          moved.current = true;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (moved.current && event.detail !== 0) {
            moved.current = false;
            return;
          }
          moved.current = false;
          setExpanded((value) => !value);
        }}
      >
        <AppIcon name={expanded ? 'chevron-left' : 'chevron-right'} />
      </button>
      {expanded && (
        <div id="vnc-fullscreen-tools" className="vnc-floating-controls">
          {children}
        </div>
      )}
    </WorkspaceRail>
  );
}
