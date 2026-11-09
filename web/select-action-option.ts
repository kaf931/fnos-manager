import type { optionRenderProps } from '@douyinfe/semi-ui/lib/es/select';
import React from 'react';
/** Keep a trailing action separate from selecting an option. */
export function renderSelectActionOption({
  option,
  actionLabel,
  onAction,
  disabled = false,
}: {
  option: optionRenderProps & { semiOptionId?: string };
  actionLabel: string;
  onAction?: (() => void) | null;
  disabled?: boolean;
}) {
  return React.createElement(
    'div',
    {
      className: [
        option.className,
        'semi-select-option',
        'native-select-action-option',
        option.selected && 'semi-select-option-selected',
        option.focused && 'semi-select-option-focused',
        option.disabled && 'semi-select-option-disabled',
      ]
        .filter(Boolean)
        .join(' '),
      style: option.style,
      role: 'option',
      'aria-selected': !!option.selected,
      'aria-disabled': !!option.disabled,
      id: option.semiOptionId,
      onClick: option.onClick,
      onMouseEnter: option.onMouseEnter,
    },
    React.createElement('span', { className: 'native-select-option-label' }, option.label),
    onAction
      ? React.createElement(
          'button',
          {
            type: 'button',
            className: 'icon-button native-select-option-action',
            'aria-label': actionLabel,
            title: actionLabel,
            disabled,
            onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => event.stopPropagation(),
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              if (!disabled) onAction();
            },
          },
          React.createElement(
            'svg',
            {
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
            },
            React.createElement('path', {
              d: 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6',
            }),
          ),
        )
      : null,
  );
}
