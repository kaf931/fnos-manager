import { resolvePopupContainer } from './ui/popup-container.js';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type AriaAttributes,
  type CSSProperties,
} from 'react';
import Select, { type SelectProps } from '@douyinfe/semi-ui/lib/es/select';
export type NativeSelectProps = Omit<SelectProps<string>, 'value' | 'onChange' | 'multiple'> &
  AriaAttributes & { value?: string; multiple?: false; onChange?: (value: string) => void };
// All native form and toolbar selects in this app choose a single string value.
export function NativeSelect({
  className = '',
  dropdownClassName = '',
  dropdownStyle = {},
  getPopupContainer,
  position = 'bottomLeft',
  onDropdownVisibleChange,
  onChange,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  ...props
}: NativeSelectProps) {
  const generatedId = useId();
  const id = props.id || 'native-select-' + generatedId;
  const labelId = id + '-label';
  const [popup, setPopup] = useState({ position, maxHeight: 244 });
  const [visible, setVisible] = useState(false);
  const select = useRef<Select<string>>(null);
  const popupContainer = useCallback(
    () => getPopupContainer?.() || resolvePopupContainer(document.getElementById(id)),
    [getPopupContainer, id],
  );
  const gap = (typeof props.spacing === 'number' ? props.spacing : (props.spacing?.y ?? 4)) + 4;
  const limit = Math.min(
    244,
    typeof dropdownStyle.maxHeight === 'number' ? dropdownStyle.maxHeight : 244,
  );
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
    const available = vertical ? (position.startsWith('top') ? above : below) : bottom - top - gap;
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
    if (available < 32 || rect.top < anchorTop || rect.bottom > anchorBottom) {
      select.current?.close();
      setVisible(false);
      return false;
    }
    const maxHeight = Math.min(limit, available);
    setPopup((previous) =>
      previous.position === position && previous.maxHeight === maxHeight
        ? previous
        : { position, maxHeight },
    );
    return true;
  }, [gap, id, limit, popupContainer, position]);
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
  const updatePlacement = (nextVisible: boolean) => {
    if (nextVisible && !measurePopup()) return;
    setVisible(nextVisible);
    onDropdownVisibleChange?.(nextVisible);
  };
  return (
    <>
      {ariaLabel && !labelledBy && (
        <span id={labelId} className="sr-only">
          {ariaLabel}
        </span>
      )}
      <Select<string>
        ref={select}
        size="default"
        position={popup.position}
        autoAdjustOverflow={false}
        showClear={false}
        {...props}
        id={id}
        rePosKey={String(props.rePosKey ?? '') + '|' + popup.maxHeight}
        aria-labelledby={labelledBy || (ariaLabel ? labelId : undefined)}
        getPopupContainer={popupContainer}
        onDropdownVisibleChange={updatePlacement}
        onChange={(value) => {
          if (typeof value === 'string' || value === undefined) onChange?.(value ?? '');
        }}
        className={'native-select ' + className}
        dropdownClassName={'native-select-dropdown ' + dropdownClassName}
        dropdownStyle={
          {
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            ...dropdownStyle,
            maxHeight: popup.maxHeight,
            '--native-select-popup-height': popup.maxHeight + 'px',
          } as CSSProperties
        }
      />
    </>
  );
}
