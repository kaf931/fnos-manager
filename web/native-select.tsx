import { useBoundedPopup } from './ui/use-bounded-popup.js';
import { resolvePopupContainer } from './ui/popup-container.js';
import {
  useCallback,
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
  const onInvalid = useCallback(() => {
    select.current?.close();
    setVisible(false);
  }, []);
  const { maxHeight, measurePopup } = useBoundedPopup({
    id,
    position,
    limit,
    gap,
    popupContainer,
    visible,
    onInvalid,
  });
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
        position={position}
        autoAdjustOverflow={false}
        showClear={false}
        {...props}
        id={id}
        rePosKey={String(props.rePosKey ?? '') + '|' + maxHeight}
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
            maxHeight: maxHeight,
            '--native-select-popup-height': maxHeight + 'px',
          } as CSSProperties
        }
      />
    </>
  );
}
