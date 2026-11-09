import React from 'react';
import Switch, { type SwitchProps } from '@douyinfe/semi-ui/lib/es/switch';

/** Keep loading geometry stable while preserving Semi Design's switch behavior. */
export function SwitchControl({ title, ...props }: SwitchProps & { title?: string }) {
  return (
    <span className="switch-control" title={title} aria-busy={props.loading || undefined}>
      <Switch {...props} />
    </span>
  );
}
