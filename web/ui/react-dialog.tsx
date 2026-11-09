import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AppIcon } from './icon-markup.js';
const editors = new Set<HTMLDialogElement>();
const dirtyEditors = new Set<HTMLDialogElement>();
const editState = () =>
  window.dispatchEvent(
    new CustomEvent('deskicons:editstate', { detail: { dirty: dirtyEditors.size > 0 } }),
  );
export function ReactDialog({
  open,
  onClose,
  title,
  children,
  footer,
  className = '',
  baseClassName = 'terminal-dialog',
  id,
  busy = false,
  size = 'medium',
  layout = 'content',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  baseClassName?: string;
  id?: string;
  busy?: boolean;
  size?: 'small' | 'medium' | 'large' | 'full-width';
  layout?: 'content' | 'fixed' | 'workspace';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const outsidePress = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const media = window.matchMedia?.('(max-width:620px)');
    const syncLayout = () => {
      if (media?.matches) editors.add(element);
      else editors.delete(element);
      element.classList.toggle('mobile-form-surface', !!media?.matches);
      document.documentElement.classList.toggle('mobile-form-page', editors.size > 0);
    };
    const releaseLayout = () => {
      media?.removeEventListener?.('change', syncLayout);
      editors.delete(element);
      element.classList.remove('mobile-form-surface');
      dirtyEditors.delete(element);
      document.documentElement.classList.toggle('mobile-form-page', editors.size > 0);
    };
    syncLayout();
    media?.addEventListener?.('change', syncLayout);
    try {
      if (!element.open) {
        element.showModal();
        // Start on the static title rather than drawing focus around the close action.
        if (!element.querySelector('[autofocus]')) heading.current?.focus({ preventScroll: true });
      }
    } catch (error) {
      releaseLayout();
      throw error;
    }
    return () => {
      if (element.open) element.close();
      releaseLayout();
      editState();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      id={id}
      ref={ref}
      data-dialog-size={size}
      data-dialog-layout={layout}
      data-react-dialog
      className={baseClassName + ' ' + className}
      aria-labelledby={titleId}
      onInput={() => {
        if (ref.current) {
          dirtyEditors.add(ref.current);
          editState();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        outsidePress.current =
          e.target === e.currentTarget &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      }}
      onClick={(e) => {
        const outside = outsidePress.current;
        outsidePress.current = false;
        if (outside && e.target === e.currentTarget && !busy) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label="关闭"
          disabled={busy}
          onClick={onClose}
        >
          <AppIcon name="close" />
        </button>
      </div>
      {children}
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
