import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CommandEntry } from './contracts/commands.js';
export function useCommandMenu({
  edit,
  remove,
}: {
  edit: (entry: CommandEntry) => void;
  remove: (entry: CommandEntry) => void | Promise<void>;
}) {
  const [context, setContext] = useState<{ entry: CommandEntry; x: number; y: number } | null>(
      null,
    ),
    menu = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(),
    press = useRef<{ x: number; y: number } | null>(null),
    suppressUntil = useRef(0);
  const close = () => setContext(null);
  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    press.current = null;
  };
  const open = (entry: CommandEntry, x: number, y: number) => {
    clear();
    setContext({ entry, x, y });
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target))
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      clear();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useLayoutEffect(() => {
    if (!menu.current || !context) return;
    const rect = menu.current.getBoundingClientRect();
    menu.current.style.left =
      Math.max(8, Math.min(context.x, window.innerWidth - rect.width - 8)) + 'px';
    menu.current.style.top =
      Math.max(8, Math.min(context.y, window.innerHeight - rect.height - 8)) + 'px';
    menu.current.querySelector('button')?.focus();
  }, [context]);
  function handlers(entry: CommandEntry): React.ButtonHTMLAttributes<HTMLButtonElement> {
    return {
      onContextMenu: (event) => {
        event.preventDefault();
        open(entry, event.clientX, event.clientY);
      },
      onKeyDown: (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          open(entry, rect.left + 12, rect.bottom);
        }
      },
      onPointerDown: (event) => {
        if (event.pointerType !== 'touch') return;
        clear();
        press.current = { x: event.clientX, y: event.clientY };
        const x = event.clientX,
          y = event.clientY;
        timer.current = setTimeout(() => {
          suppressUntil.current = Date.now() + 800;
          open(entry, x, y);
        }, 550);
      },
      onPointerMove: (event) => {
        if (
          press.current &&
          Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8
        )
          clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
    };
  }
  return {
    close,
    handlers,
    get suppressClick() {
      return Date.now() < suppressUntil.current;
    },
    content: context
      ? createPortal(
          <div
            ref={menu}
            className="terminal-tree-menu"
            role="menu"
            aria-label="命令操作"
            style={{ left: context.x, top: context.y }}
          >
            <button
              role="menuitem"
              onClick={() => {
                close();
                edit(context.entry);
              }}
            >
              编辑
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                close();
                void remove(context.entry);
              }}
            >
              删除
            </button>
          </div>,
          document.body,
        )
      : null,
  };
}
