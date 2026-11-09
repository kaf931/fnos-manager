/** Panel geometry shared by React pointer/keyboard handlers. */
export const DEFAULT_TERMINAL_PANEL_WIDTH = 360;
export function clampTerminalPanelWidth(width: number, workspaceWidth: number) {
  const maximum = Math.max(240, Math.min(640, workspaceWidth - 372));
  return Math.min(
    maximum,
    Math.max(240, Number.isFinite(width) ? width : DEFAULT_TERMINAL_PANEL_WIDTH),
  );
}
