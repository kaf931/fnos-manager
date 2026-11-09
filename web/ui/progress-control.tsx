import React from 'react';
import Progress from '@douyinfe/semi-ui/lib/es/progress';
/** Shared Semi progress control; percentages always come from actual transferred bytes. */
export function ProgressControl({ percent, label }: { percent: number; label: string }) {
  return <Progress percent={percent} aria-label={label} />;
}
