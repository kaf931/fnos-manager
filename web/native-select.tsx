import { useId, useState, type AriaAttributes, type CSSProperties } from 'react';
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
  const popupContainer = () =>
    getPopupContainer?.() || document.getElementById(id)?.closest('dialog') || document.body;
  const updatePlacement = (visible: boolean) => {
    if (visible) {
      const trigger = document.getElementById(id);
      if (trigger) {
        const rect = trigger.getBoundingClientRect(),
          container = popupContainer();
        const bounds = container === document.body ? null : container.getBoundingClientRect();
        // Keep the requested direction and scroll within the dialog’s remaining space.
        const top = Math.max(0, bounds?.top ?? 0),
          bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight),
          gap = (typeof props.spacing === 'number' ? props.spacing : (props.spacing?.y ?? 4)) + 4,
          above = Math.max(0, rect.top - top - gap),
          below = Math.max(0, bottom - rect.bottom - gap),
          limit = Math.min(
            244,
            typeof dropdownStyle.maxHeight === 'number' ? dropdownStyle.maxHeight : 244,
          );
        const vertical = position.startsWith('top') || position.startsWith('bottom');
        const available = vertical
          ? position.startsWith('top')
            ? above
            : below
          : bottom - top - gap;
        setPopup({ position, maxHeight: Math.max(8, Math.min(limit, available)) });
      }
    }
    onDropdownVisibleChange?.(visible);
  };
  return (
    <>
      {ariaLabel && !labelledBy && (
        <span id={labelId} className="sr-only">
          {ariaLabel}
        </span>
      )}
      <Select<string>
        size="default"
        position={popup.position}
        autoAdjustOverflow={false}
        showClear={false}
        {...props}
        id={id}
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
