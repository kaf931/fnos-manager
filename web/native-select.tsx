import { useId, type AriaAttributes } from 'react';
import Select, { type SelectProps } from '@douyinfe/semi-ui/lib/es/select';
export type NativeSelectProps = Omit<SelectProps<string>, 'value' | 'onChange' | 'multiple'> &
  AriaAttributes & { value?: string; multiple?: false; onChange?: (value: string) => void };
// All native form and toolbar selects in this app choose a single string value.
export function NativeSelect({
  className = '',
  dropdownClassName = '',
  dropdownStyle = {},
  getPopupContainer,
  onChange,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  ...props
}: NativeSelectProps) {
  const generatedId = useId();
  const id = props.id || 'native-select-' + generatedId;
  const labelId = id + '-label';
  return (
    <>
      {ariaLabel && !labelledBy && (
        <span id={labelId} className="sr-only">
          {ariaLabel}
        </span>
      )}
      <Select<string>
        size="default"
        position="bottomLeft"
        autoAdjustOverflow
        showClear={false}
        {...props}
        id={id}
        aria-labelledby={labelledBy || (ariaLabel ? labelId : undefined)}
        getPopupContainer={
          getPopupContainer ||
          (() => document.getElementById(id)?.closest('dialog') || document.body)
        }
        onChange={(value) => {
          if (typeof value === 'string' || value === undefined) onChange?.(value ?? '');
        }}
        className={'native-select ' + className}
        dropdownClassName={'task-form-dropdown native-select-dropdown ' + dropdownClassName}
        dropdownStyle={{
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 244,
          overflow: 'hidden',
          ...dropdownStyle,
        }}
      />
    </>
  );
}
