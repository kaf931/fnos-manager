import React, { useId } from 'react';
import type { VncSettings } from '../backend/domain/vnc.js';
import { NativeSelect } from './native-select.js';
import { AppIcon } from './ui/icon-markup.js';

export interface VncSettingsPanelProps {
  value: VncSettings;
  connected: boolean;
  sharedLocked?: boolean;
  saving?: boolean;
  getPopupContainer?: () => HTMLElement;
  onChange: (value: VncSettings) => void;
  onSave: () => void;
  onClose: () => void;
}

/** Connection settings use the same controls and panel surfaces as terminal tools. */
export function VncSettingsPanel({
  value,
  connected,
  sharedLocked = false,
  saving = false,
  getPopupContainer,
  onChange,
  onSave,
  onClose,
}: VncSettingsPanelProps) {
  const scope = useId();
  const update = <K extends keyof VncSettings>(key: K, next: VncSettings[K]) =>
    onChange({ ...value, [key]: next });
  const checkbox = (
    key: 'shared' | 'viewOnly' | 'clipViewport' | 'showDotCursor' | 'autoReconnect',
    label: string,
    disabled = false,
  ) => (
    <div className="form-check-row">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={value[key]}
          disabled={saving || disabled}
          onChange={(event) => update(key, event.target.checked)}
        />
        {label}
      </label>
    </div>
  );
  const number = (
    key: 'qualityLevel' | 'compressionLevel' | 'reconnectDelay',
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <>
      <label htmlFor={scope + key}>{label}</label>
      <input
        id={scope + key}
        className="form-input"
        type="number"
        value={value[key]}
        min={min}
        max={max}
        step={step}
        disabled={saving}
        onChange={(event) => {
          if (event.target.value === '') return;
          const next = Number(event.target.value);
          if (Number.isFinite(next)) update(key, Math.max(min, Math.min(max, Math.round(next))));
        }}
      />
    </>
  );
  const popupContainer =
    getPopupContainer ||
    (() => (document.fullscreenElement as HTMLElement | null) || document.body);
  return (
    <>
      <div className="terminal-assets-header">
        <strong>远程桌面设置</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="收起远程桌面设置"
          onClick={onClose}
        >
          <AppIcon name="close" />
        </button>
      </div>
      <div className="terminal-tree task-form-body">
        {checkbox('viewOnly', '仅查看')}
        {checkbox('clipViewport', '裁剪视口', value.scaleMode !== 'off')}
        <label id={scope + 'scale'}>缩放方式</label>
        <div className="task-form-control">
          <NativeSelect
            aria-labelledby={scope + 'scale'}
            value={value.scaleMode}
            disabled={saving}
            getPopupContainer={popupContainer}
            optionList={[
              { value: 'off', label: '实际大小' },
              { value: 'scale', label: '本地缩放' },
              { value: 'remote', label: '调整远程分辨率' },
            ]}
            onChange={(next) => update('scaleMode', next as VncSettings['scaleMode'])}
          />
        </div>
        {number('qualityLevel', '图像质量（0–9）', 0, 9, 1)}
        {number('compressionLevel', '压缩级别（0–9）', 0, 9, 1)}
        <label id={scope + 'cursor'}>光标模式</label>
        <div className="task-form-control">
          <NativeSelect
            aria-labelledby={scope + 'cursor'}
            value={value.cursorMode}
            disabled={saving}
            getPopupContainer={popupContainer}
            optionList={[
              { value: 'local', label: '本机光标' },
              { value: 'remote', label: '远程光标' },
            ]}
            onChange={(next) => update('cursorMode', next as VncSettings['cursorMode'])}
          />
        </div>
        {checkbox('showDotCursor', '无远程光标时显示圆点', value.cursorMode === 'local')}
        {checkbox('autoReconnect', '断线自动重连')}
        {number('reconnectDelay', '重连等待（毫秒）', 1000, 60000, 1000)}
        {checkbox('shared', '共享连接', connected || sharedLocked)}
        <label htmlFor={scope + 'repeater'}>Repeater ID</label>
        <input
          id={scope + 'repeater'}
          className="form-input"
          type="text"
          value={value.repeaterId}
          maxLength={250}
          disabled={saving || connected}
          autoComplete="off"
          onChange={(event) => update('repeaterId', event.target.value)}
        />
        <p className="help">共享连接和 Repeater ID 在下次连接时生效。</p>
        <label id={scope + 'logging'}>协议日志级别</label>
        <div className="task-form-control">
          <NativeSelect
            aria-labelledby={scope + 'logging'}
            value={value.logging}
            disabled={saving}
            getPopupContainer={popupContainer}
            optionList={[
              { value: 'error', label: '错误' },
              { value: 'warn', label: '警告' },
              { value: 'info', label: '信息' },
              { value: 'debug', label: '调试' },
            ]}
            onChange={(next) => update('logging', next as VncSettings['logging'])}
          />
        </div>
      </div>
      <div className="dialog-footer">
        <button type="button" className="primary" disabled={saving} onClick={onSave}>
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>
    </>
  );
}
