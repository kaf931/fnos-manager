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
/** Captured pointer gestures and keyboard sorting share the same commit path. */
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
    pointerActive = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null),
    [over, setOver] = useState<string | null>(null);
  function clear() {
    clearTimeout(press.current);
    drag.current = null;
    target.current = null;
    pointerActive.current = false;
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
  function updateTarget(x: number, y: number) {
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-sortable-id]');
    target.current = node && host.current?.contains(node) ? node.dataset.sortableId || null : null;
    setOver(target.current);
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
        >
          {item.content(
            <button
              type="button"
              className="icon-button sortable-card-handle"
              draggable={false}
              disabled={disabled}
              aria-label={'拖动排序 ' + item.name}
              title="拖动排序，或使用方向键调整位置"
              onDragStart={(e) => e.preventDefault()}
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
                if (
                  disabled ||
                  e.isPrimary === false ||
                  (e.pointerType === 'mouse' && e.button !== 0)
                )
                  return;
                start.current = { x: e.clientX, y: e.clientY };
                const element = e.currentTarget,
                  pointer = e.pointerId;
                const activate = () => {
                  pointerActive.current = true;
                  begin(item.id);
                  element.setPointerCapture(pointer);
                };
                if (e.pointerType === 'mouse') activate();
                else press.current = setTimeout(activate, 250);
              }}
              onPointerMove={(e) => {
                if (!pointerActive.current) {
                  if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8)
                    clearTimeout(press.current);
                  return;
                }
                e.preventDefault();
                updateTarget(e.clientX, e.clientY);
                const scroller = host.current?.closest<HTMLElement>('.task-form-body');
                if (scroller) {
                  const rect = scroller.getBoundingClientRect();
                  if (e.clientY < rect.top + 32) scroller.scrollBy({ top: -16 });
                  else if (e.clientY > rect.bottom - 32) scroller.scrollBy({ top: 16 });
                }
              }}
              onPointerUp={(e) => {
                clearTimeout(press.current);
                if (pointerActive.current) {
                  updateTarget(e.clientX, e.clientY);
                  finish();
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              onPointerCancel={clear}
              onLostPointerCapture={clear}
            >
              <AppIcon name="grip" />
            </button>,
          )}
        </div>
      ))}
    </div>
  );
}
