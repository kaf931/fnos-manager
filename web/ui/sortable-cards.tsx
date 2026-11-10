import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from './icon-markup.js';
export function moveCard(keys: string[], from: string, to: string) {
  const result = [...keys],
    start = result.indexOf(from),
    end = result.indexOf(to);
  if (start < 0 || end < 0 || start === end) return result;
  result.splice(start, 1);
  result.splice(end, 0, from);
  return result;
}
/** Native desktop dragging, touch handles and keyboard sorting share the same commit path. */
export function SortableCards({
  items,
  onMove,
  disabled = false,
}: {
  items: { id: string; name: string; content: (handle: ReactNode) => ReactNode }[];
  onMove: (from: string, to: string) => void;
  disabled?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    drag = useRef<string | null>(null),
    target = useRef<string | null>(null),
    press = useRef<ReturnType<typeof setTimeout>>(),
    start = useRef({ x: 0, y: 0 }),
    touch = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null),
    [over, setOver] = useState<string | null>(null);
  function clear() {
    clearTimeout(press.current);
    drag.current = null;
    target.current = null;
    touch.current = false;
    setDragging(null);
    setOver(null);
  }
  useEffect(
    () => () => {
      clearTimeout(press.current);
      drag.current = null;
      target.current = null;
    },
    [],
  );
  function begin(id: string) {
    drag.current = id;
    target.current = id;
    setDragging(id);
  }
  function finish() {
    const from = drag.current,
      to = target.current;
    clear();
    if (from && to && from !== to && !disabled) onMove(from, to);
  }
  return (
    <div ref={host} className="cards" role="list" aria-label="模板排序">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="sortable-card"
          role="listitem"
          data-sortable-id={item.id}
          data-dragging={dragging === item.id || undefined}
          data-drop-target={over === item.id || undefined}
          onDragOver={(e) => {
            if (!drag.current || disabled) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            target.current = item.id;
            setOver(item.id);
          }}
          onDrop={(e) => {
            if (!drag.current || disabled) return;
            e.preventDefault();
            target.current = item.id;
            finish();
          }}
        >
          {item.content(
            <button
              type="button"
              className="icon-button sortable-card-handle"
              draggable={!disabled}
              disabled={disabled}
              aria-label={'拖动排序 ' + item.name}
              title="拖动排序，或使用方向键调整位置"
              onDragStart={(e) => {
                if (disabled) {
                  e.preventDefault();
                  return;
                }
                clearTimeout(press.current);
                touch.current = false;
                begin(item.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
              }}
              onDragEnd={clear}
              onKeyDown={(e) => {
                const direction = ['ArrowLeft', 'ArrowUp'].includes(e.key)
                  ? -1
                  : ['ArrowRight', 'ArrowDown'].includes(e.key)
                    ? 1
                    : 0;
                if (!direction) return;
                e.preventDefault();
                const next = items[index + direction];
                if (next && !disabled) onMove(item.id, next.id);
              }}
              onPointerDown={(e) => {
                if (disabled || e.pointerType === 'mouse') return;
                start.current = { x: e.clientX, y: e.clientY };
                const element = e.currentTarget,
                  pointer = e.pointerId;
                press.current = setTimeout(() => {
                  touch.current = true;
                  begin(item.id);
                  element.setPointerCapture(pointer);
                }, 250);
              }}
              onPointerMove={(e) => {
                if (!touch.current) {
                  if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8)
                    clearTimeout(press.current);
                  return;
                }
                e.preventDefault();
                const node = document
                  .elementFromPoint(e.clientX, e.clientY)
                  ?.closest<HTMLElement>('[data-sortable-id]');
                if (node && host.current?.contains(node)) {
                  target.current = node.dataset.sortableId || null;
                  setOver(target.current);
                }
                const scroller = host.current?.closest<HTMLElement>('.task-form-body');
                if (scroller) {
                  const rect = scroller.getBoundingClientRect();
                  if (e.clientY < rect.top + 32) scroller.scrollBy({ top: -16 });
                  else if (e.clientY > rect.bottom - 32) scroller.scrollBy({ top: 16 });
                }
              }}
              onPointerUp={(e) => {
                clearTimeout(press.current);
                if (touch.current) {
                  finish();
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              onPointerCancel={clear}
            >
              <AppIcon name="move" />
            </button>,
          )}
        </div>
      ))}
    </div>
  );
}
