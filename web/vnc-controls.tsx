import React from 'react';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';
import { AppIcon } from './ui/icon-markup.js';
export type VncAction =
  | 'settings'
  | 'drag'
  | 'ctrl'
  | 'alt'
  | 'meta'
  | 'tab'
  | 'disconnect'
  | 'shutdown'
  | 'reboot'
  | 'reset'
  | 'fullscreen'
  | 'clipboard'
  | 'keyboard'
  | 'ctrl-alt-delete'
  | 'alt-tab'
  | 'escape'
  | 'retry'
  | 'logs';
export interface VncControlProps {
  fullscreen: boolean;
  keyboardOpen: boolean;
  clipboardOpen?: boolean;
  connected: boolean;
  viewOnly?: boolean;
  canRetry: boolean;
  logsOpen?: boolean;
  settingsOpen?: boolean;
  settingsAvailable?: boolean;
  dragEnabled?: boolean;
  dragging?: boolean;
  modifiers?: { ctrl: boolean; alt: boolean; meta: boolean };
  powerSupported?: boolean;
  getPopupContainer?: () => HTMLElement;
  onAction: (action: VncAction) => void;
}
/** Use the existing workspace rail dimensions, selection states and tooltip surface. */
export function VncControls({
  fullscreen,
  keyboardOpen,
  clipboardOpen = false,
  connected,
  viewOnly = false,
  canRetry,
  logsOpen = false,
  settingsOpen = false,
  settingsAvailable = true,
  dragEnabled = false,
  dragging = false,
  modifiers = { ctrl: false, alt: false, meta: false },
  powerSupported = false,
  getPopupContainer,
  onAction,
}: VncControlProps) {
  const button = (
    action: VncAction,
    label: string,
    glyph: string,
    disabled = false,
    pressed?: boolean,
    triggerOnly = false,
  ) => (
    <button
      key={action}
      type="button"
      className={
        'icon-button' + (pressed ? ' selected' : '') + (action === 'disconnect' ? ' danger' : '')
      }
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={triggerOnly ? undefined : () => onAction(action)}
    >
      <AppIcon name={glyph} />
    </button>
  );
  return (
    <>
      {button('fullscreen', fullscreen ? '退出全屏' : '全屏', 'expand', false, fullscreen)}
      {button('clipboard', '剪贴板', 'clipboard', !connected, clipboardOpen)}
      {button('keyboard', '文字输入', 'keyboard', !connected || viewOnly, keyboardOpen)}
      <Dropdown
        getPopupContainer={getPopupContainer}
        trigger="click"
        clickTriggerToHide
        position="rightTop"
        spacing={8}
        render={
          <Dropdown.Menu className="workspace-action-menu">
            {(['ctrl', 'alt', 'meta'] as const).map((action) => (
              <Dropdown.Item
                key={action}
                disabled={!connected || viewOnly}
                onClick={() => onAction(action)}
              >
                <span role="menuitemcheckbox" aria-checked={modifiers[action]}>
                  {modifiers[action] ? '✓ ' : ''}
                  {action === 'meta' ? 'Windows' : action === 'ctrl' ? 'Ctrl' : 'Alt'}
                </span>
              </Dropdown.Item>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item disabled={!connected || viewOnly} onClick={() => onAction('tab')}>
              Tab
            </Dropdown.Item>
            <Dropdown.Item
              disabled={!connected || viewOnly}
              onClick={() => onAction('ctrl-alt-delete')}
            >
              Ctrl+Alt+Delete
            </Dropdown.Item>
            <Dropdown.Item disabled={!connected || viewOnly} onClick={() => onAction('alt-tab')}>
              Alt+Tab
            </Dropdown.Item>
            <Dropdown.Item disabled={!connected || viewOnly} onClick={() => onAction('escape')}>
              Esc
            </Dropdown.Item>
          </Dropdown.Menu>
        }
      >
        <button
          type="button"
          className="icon-button"
          disabled={!connected || viewOnly}
          aria-label="特殊按键"
        >
          <AppIcon name="more" />
        </button>
      </Dropdown>
      {settingsAvailable && button('settings', '远程桌面设置', 'settings', false, settingsOpen)}
      {button('logs', '连接日志', 'history', false, logsOpen)}
      {button('disconnect', '断开连接', 'close', !connected)}
      {dragEnabled && button('drag', '拖动视口', 'move', !connected || viewOnly, dragging)}
      {powerSupported && (
        <Dropdown
          getPopupContainer={getPopupContainer}
          trigger="click"
          clickTriggerToHide
          position="rightTop"
          spacing={8}
          render={
            <Dropdown.Menu className="workspace-action-menu">
              <Dropdown.Item disabled={!connected || viewOnly} onClick={() => onAction('shutdown')}>
                关机…
              </Dropdown.Item>
              <Dropdown.Item disabled={!connected || viewOnly} onClick={() => onAction('reboot')}>
                重启…
              </Dropdown.Item>
              <Dropdown.Item disabled={!connected || viewOnly} onClick={() => onAction('reset')}>
                强制重置…
              </Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          {button('shutdown', '远程电源', 'power', !connected || viewOnly, undefined, true)}
        </Dropdown>
      )}
      {canRetry && button('retry', '重新连接', 'refresh')}
    </>
  );
}
