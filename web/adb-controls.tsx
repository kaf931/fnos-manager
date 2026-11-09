import type { AdbScreenAction, AdbScreenSize } from '../backend/domain/adb.js';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';
import { AppIcon } from './ui/icon-markup.js';

/** Android actions use the same dropdown interaction and surfaces as VNC special keys. */
export function AdbControls({
  ready,
  available = true,
  software,
  onKey,
  onSoftware,
  onAction,
  maxSize = 1280,
  onSize,
}: {
  maxSize?: AdbScreenSize;
  onSize?: (size: AdbScreenSize) => void;
  ready: boolean;
  available?: boolean;
  software: boolean;
  onKey: (code: number) => void;
  onSoftware: () => void;
  onAction: (action: AdbScreenAction) => void;
}) {
  return (
    <Dropdown
      trigger="click"
      clickTriggerToHide
      position="rightTop"
      spacing={8}
      getPopupContainer={() => (document.fullscreenElement as HTMLElement) || document.body}
      render={
        <Dropdown.Menu className="workspace-action-menu">
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(4)}>
            返回
          </Dropdown.Item>
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(3)}>
            主页
          </Dropdown.Item>
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(187)}>
            最近任务
          </Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(224)}>
            唤醒屏幕
          </Dropdown.Item>
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(223)}>
            熄灭屏幕
          </Dropdown.Item>
          {(
            [
              ['rotate', '旋转设备屏幕'],
              ['display-off', '关闭实体屏幕'],
              ['display-on', '打开实体屏幕'],
            ] as const
          ).map(([action, label]) => (
            <Dropdown.Item
              key={action}
              disabled={!available || !ready}
              onClick={() => onAction(action)}
            >
              {label}
            </Dropdown.Item>
          ))}
          <Dropdown.Divider />
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(24)}>
            音量增加
          </Dropdown.Item>
          <Dropdown.Item disabled={!available || !ready} onClick={() => onKey(25)}>
            音量降低
          </Dropdown.Item>
          <Dropdown.Divider />
          {onSize && (
            <>
              <Dropdown.Title>投屏清晰度</Dropdown.Title>
              {(
                [
                  [720, '流畅 · 720px'],
                  [1280, '均衡 · 1280px'],
                  [1920, '高清 · 1920px'],
                  [0, '原始分辨率'],
                ] as const
              ).map(([size, label]) => (
                <Dropdown.Item
                  key={size}
                  disabled={!available || maxSize === size}
                  onClick={() => onSize(size)}
                >
                  {label}
                  {maxSize === size ? '（当前）' : ''}
                </Dropdown.Item>
              ))}
              <Dropdown.Divider />
            </>
          )}
          <Dropdown.Item disabled={!available} onClick={onSoftware}>
            {software ? '关闭软件解码' : '开启软件解码'}
          </Dropdown.Item>
        </Dropdown.Menu>
      }
    >
      <button type="button" className="icon-button" aria-label="设备操作" disabled={!available}>
        <AppIcon name="more" />
      </button>
    </Dropdown>
  );
}
