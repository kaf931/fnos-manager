import React, { useCallback, useId, useState } from 'react';
import Dropdown, { type DropdownProps } from '@douyinfe/semi-ui/lib/es/dropdown';
import { resolvePopupContainer } from './popup-container.js';
import { useBoundedPopup } from './use-bounded-popup.js';

/** Operation menus share the same clipping and lifecycle rules as form selects. */
export function BoundedDropdown({
  children,
  position = 'bottomRight',
  visible: controlledVisible,
  onVisibleChange,
  onEscKeyDown,
  getPopupContainer,
  style = {},
  ...props
}: Omit<DropdownProps, 'children'> & {
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}) {
  const generatedId = useId();
  const id = children.props.id || 'operation-menu-' + generatedId;
  const [open, setOpen] = useState(false);
  const visible = controlledVisible ?? open;
  const changeVisible = useCallback(
    (next: boolean) => {
      setOpen(next);
      onVisibleChange?.(next);
    },
    [onVisibleChange],
  );
  const onInvalid = useCallback(() => changeVisible(false), [changeVisible]);
  const popupContainer = useCallback(
    () => getPopupContainer?.() || resolvePopupContainer(document.getElementById(id)),
    [getPopupContainer, id],
  );
  const gap = (typeof props.spacing === 'number' ? props.spacing : (props.spacing?.y ?? 4)) + 4;
  const limit = Math.min(480, typeof style.maxHeight === 'number' ? style.maxHeight : 480);
  const { maxHeight, measurePopup } = useBoundedPopup({
    id,
    position,
    limit,
    gap,
    popupContainer,
    visible,
    onInvalid,
    offsetY: typeof props.spacing === 'object' ? (props.spacing.y ?? 0) : 0,
    viewportInset: 32,
  });
  return (
    <Dropdown
      {...props}
      position={position}
      visible={visible}
      autoAdjustOverflow={false}
      getPopupContainer={popupContainer}
      rePosKey={String(props.rePosKey ?? '') + '|' + maxHeight}
      style={{ ...style, maxHeight, overflowY: 'auto', overscrollBehavior: 'contain' }}
      onEscKeyDown={(event) => {
        // Semi closes the menu; suppress the browser's additional dialog dismissal.
        if (visible) event.preventDefault();
        onEscKeyDown?.(event);
      }}
      onVisibleChange={(next) => {
        if (next && !measurePopup()) return;
        changeVisible(next);
      }}
    >
      {React.cloneElement(children, {
        id,
        onKeyDownCapture: (event) => {
          children.props.onKeyDownCapture?.(event);
          // Semi consumes Escape on its trigger even while closed. Leave the native
          // dialog default action available once there is no menu left to dismiss.
          if (!visible && event.key === 'Escape') event.stopPropagation();
        },
      })}
    </Dropdown>
  );
}
