import React from 'react';
import { AppIcon } from './ui/icon-markup.js';

export function VncClipboardPanel({
  value,
  connected,
  onChange,
  onSend,
  onClose,
}: {
  value: string;
  connected: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="terminal-assets-header">
        <strong>剪贴板</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="收起剪贴板"
          title="收起剪贴板"
          onClick={onClose}
        >
          <AppIcon name="close" />
        </button>
      </div>
      <div className="terminal-tree vnc-clipboard-body">
        <textarea
          className="form-input"
          aria-label="剪贴板内容"
          value={value}
          maxLength={262144}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div className="dialog-footer vnc-clipboard-footer">
        <button type="button" className="primary" disabled={!connected} onClick={onSend}>
          发送到远程
        </button>
      </div>
    </>
  );
}
