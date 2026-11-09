import type { ExecutionMode, AiModelOption } from './contracts/ai.js';
import React from 'react';
import { AiTooltipButton as AiIconButton, AiTooltip } from './ai-tooltip.js';
import { NativeSelect } from './native-select.js';
export function AiControls({
  onModel,
  onMode,
  onAttach,
  onSend,
  onStop,
  model,
  models,
  mode = 'review',
  busy,
  pending,
  disabled,
  submitting,
  stopping = false,
}: AiControlState & AiControlActions) {
  const canStop = busy || pending || stopping;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('span', { id: 'terminal-ai-model-label', className: 'sr-only' }, 'AI 模型'),
    React.createElement(
      'span',
      { id: 'terminal-ai-mode-label', className: 'sr-only' },
      mode === 'silent' ? '执行权限：静默，自动执行命令' : '执行权限：审核，执行前确认',
    ),
    React.createElement(NativeSelect, {
      'aria-labelledby': 'terminal-ai-model-label',
      className: 'terminal-ai-model-select',
      value: model || undefined,
      placeholder: '模型',
      filter: true,
      disabled: disabled || busy || pending || submitting || !model,
      optionList: models,
      onChange: (value: string | number | undefined) => onModel(String(value ?? '')),
    }),
    React.createElement(
      AiTooltip,
      {
        content: mode === 'silent' ? '静默：自动执行命令' : '审核：执行前确认',
      },
      React.createElement(
        'span',
        { className: 'terminal-ai-mode-control' },
        React.createElement(NativeSelect, {
          'aria-labelledby': 'terminal-ai-mode-label',
          className: 'terminal-ai-mode-select',
          showArrow: false,
          dropdownMatchSelectWidth: false,
          dropdownStyle: { minWidth: 180 },
          renderSelectedItem: () =>
            React.createElement(
              'span',
              null,
              React.createElement(
                'svg',
                {
                  width: 16,
                  height: 16,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.8,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  'aria-hidden': true,
                },
                React.createElement('path', {
                  d:
                    mode === 'silent'
                      ? 'm13 2-9 12h7l-1 8 10-13h-7l1-7Z'
                      : 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
                }),
              ),
            ),
          value: mode,
          disabled: disabled || busy || pending || submitting,
          optionList: [
            { value: 'review', label: '审核 · 执行前确认' },
            { value: 'silent', label: '静默 · 自动执行' },
          ],
          onChange: (value: string | number | undefined) => {
            if (value === 'review' || value === 'silent') onMode(value);
          },
        }),
      ),
    ),
    React.createElement(AiIconButton, {
      label: '添加附件',
      icon: 'attachment',
      className: 'icon-button input-icon-button',
      disabled: disabled || busy || pending || submitting,
      onClick: onAttach,
    }),
    React.createElement(
      'span',
      { className: 'terminal-ai-send' },
      React.createElement(AiIconButton, {
        label: stopping ? '正在停止 AI 操作' : canStop ? '停止 AI 操作' : '发送消息',
        icon: canStop ? 'stop' : 'send',
        className: 'icon-button primary',
        disabled: disabled || submitting || stopping,
        onClick: canStop ? onStop : onSend,
      }),
    ),
  );
}

export interface AiControlActions {
  onAttach?: () => void;
  onModel: (value: string) => void;
  onMode: (value: ExecutionMode) => void;
  onSend: () => void;
  onStop: () => void;
}
export interface AiControlState {
  model: string;
  models: AiModelOption[];
  mode?: ExecutionMode;
  busy: boolean;
  pending: boolean;
  disabled: boolean;
  submitting: boolean;
  stopping?: boolean;
}
