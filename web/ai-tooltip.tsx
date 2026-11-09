import type React from 'react';
import Tooltip from '@douyinfe/semi-ui/lib/es/tooltip';
import { AiIconButton } from './terminal-ai-icons.js';
export function AiTooltip({ content, children }: { content: string; children?: React.ReactNode }) {
  return (
    <Tooltip content={content} position="top">
      {children}
    </Tooltip>
  );
}
export function AiTooltipButton({ label, ...props }: React.ComponentProps<typeof AiIconButton>) {
  return (
    <AiTooltip content={label}>
      <AiIconButton label={label} {...props} title={undefined} />
    </AiTooltip>
  );
}
