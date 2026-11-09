import type { ReactNode, ComponentProps } from 'react';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';

/** One context-menu surface and placement for remote file protocols. */
export function FileMenuSurface({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <Dropdown
      trigger="custom"
      visible
      position="bottomLeft"
      motion={false}
      autoAdjustOverflow
      getPopupContainer={() => (document.fullscreenElement as HTMLElement) || document.body}
      render={<Dropdown.Menu className="terminal-file-context-menu">{children}</Dropdown.Menu>}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: Math.max(8, Math.min(x, window.innerWidth - 180)),
          top: Math.max(8, y),
          width: 1,
          height: 1,
          pointerEvents: 'none',
        }}
      />
    </Dropdown>
  );
}
export function FileMenuItem(props: ComponentProps<typeof Dropdown.Item>) {
  return <Dropdown.Item {...props} />;
}
export function FileMenuDivider() {
  return <Dropdown.Divider />;
}
