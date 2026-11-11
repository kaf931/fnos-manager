import { useCallback, useEffect, useState } from 'react';
/** Bound dropdowns to their owning dialog and visible viewport without flipping direction. */
export function useBoundedPopup({
  id,
  position,
  limit,
  gap,
  popupContainer,
  visible,
  onInvalid,
  offsetY = 0,
  viewportInset = 0,
}: {
  id: string;
  position: string;
  limit: number;
  gap: number;
  popupContainer: () => HTMLElement;
  visible: boolean;
  onInvalid: () => void;
  offsetY?: number;
  viewportInset?: number;
}) {
  const [popup, setPopup] = useState({ position, maxHeight: limit });
  const measurePopup = useCallback(() => {
    const trigger = document.getElementById(id);
    if (!trigger) return false;
    const rect = trigger.getBoundingClientRect(),
      container = popupContainer();
    const bounds = container === document.body ? null : container.getBoundingClientRect();
    const viewport = window.visualViewport,
      viewportTop = viewport?.offsetTop ?? 0,
      viewportBottom = viewportTop + (viewport?.height || window.innerHeight),
      top = Math.max(viewportTop, bounds?.top ?? viewportTop),
      bottom = Math.min(viewportBottom, bounds?.bottom ?? viewportBottom),
      above = Math.max(0, rect.top - top - gap),
      below = Math.max(0, bottom - rect.bottom - gap);
    // Keep the requested direction; only the bounded scroll area changes.
    const vertical = position.startsWith('top') || position.startsWith('bottom');
    const alignedOutside =
      !vertical &&
      ((position.endsWith('Bottom') && rect.bottom + offsetY > bottom) ||
        (position.endsWith('Top') && rect.top + offsetY < top));
    const available = vertical
      ? position.startsWith('top')
        ? above
        : below
      : position.endsWith('Bottom')
        ? Math.max(0, Math.min(bottom, rect.bottom + offsetY) - top - 4)
        : position.endsWith('Top')
          ? Math.max(0, bottom - Math.max(top, rect.top + offsetY) - 4)
          : Math.max(
              0,
              2 *
                Math.min(
                  (rect.top + rect.bottom) / 2 + offsetY - top,
                  bottom - (rect.top + rect.bottom) / 2 - offsetY,
                ) -
                8,
            );
    let anchorTop = top,
      anchorBottom = bottom;
    for (
      let ancestor = trigger.parentElement;
      ancestor && ancestor !== container;
      ancestor = ancestor.parentElement
    ) {
      const style = window.getComputedStyle(ancestor);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
        const area = ancestor.getBoundingClientRect();
        anchorTop = Math.max(anchorTop, area.top);
        anchorBottom = Math.min(anchorBottom, area.bottom);
      }
    }
    // A popup cannot remain usable when its anchor is outside a clipped form.
    if (alignedOutside || available < 32 || rect.top < anchorTop || rect.bottom > anchorBottom) {
      onInvalid();
      return false;
    }
    const maxHeight = Math.min(
      limit,
      available,
      Math.max(0, viewportBottom - viewportTop - viewportInset),
    );
    setPopup((previous) =>
      previous.position === position && previous.maxHeight === maxHeight
        ? previous
        : { position, maxHeight },
    );
    return true;
  }, [gap, id, limit, offsetY, onInvalid, popupContainer, position, viewportInset]);
  useEffect(() => {
    if (!visible) return;
    measurePopup();
    window.addEventListener('resize', measurePopup);
    window.addEventListener('scroll', measurePopup, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', measurePopup);
    viewport?.addEventListener('scroll', measurePopup);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measurePopup);
    const trigger = document.getElementById(id),
      container = popupContainer();
    if (trigger) observer?.observe(trigger);
    if (container !== document.body) observer?.observe(container);
    return () => {
      window.removeEventListener('resize', measurePopup);
      window.removeEventListener('scroll', measurePopup, true);
      viewport?.removeEventListener('resize', measurePopup);
      viewport?.removeEventListener('scroll', measurePopup);
      observer?.disconnect();
    };
  }, [id, measurePopup, popupContainer, visible]);
  return { maxHeight: popup.maxHeight, measurePopup };
}
