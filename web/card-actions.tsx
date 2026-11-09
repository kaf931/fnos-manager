import React from 'react';
import Tooltip from '@douyinfe/semi-ui/lib/es/tooltip';
import type { IconMarkup } from './contracts/shared.js';
export interface CardActionProps {
  action: string;
  label: string;
  glyph: string;
  id?: string;
  icon: IconMarkup;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}
export function CardAction({
  action,
  label,
  glyph,
  id,
  icon,
  onClick,
  className,
}: CardActionProps) {
  const [hovered, setHovered] = React.useState(false),
    [focused, setFocused] = React.useState(false);
  return (
    <Tooltip content={label} position="top" trigger="custom" visible={hovered || focused}>
      <button
        type="button"
        className={className}
        onClick={onClick}
        data-action={action}
        data-id={id}
        aria-label={label}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <span dangerouslySetInnerHTML={{ __html: icon(glyph) }} />
      </button>
    </Tooltip>
  );
}
