import React from 'react';
import { SwitchControl } from './ui/switch-control.js';
import type { TaskCapabilities, TaskRecord } from './contracts/tasks.js';

export function taskEnableDisabledReason(task: TaskRecord, caps?: TaskCapabilities) {
  if (task.running) return '任务正在执行';
  if (task.pendingReason) return task.pendingReason + '，请先编辑任务';
  if (task.enabled) return '';
  if (!caps) return '正在读取任务可用状态';
  const type = caps.types.find((item) => item.id === task.type);
  if (type?.support === 'oauth' && !caps.connection.connected) return '请先连接官方授权';
  if (!type?.available || !type.ready) return '当前环境不支持启用此任务';
  return '';
}

export function TaskEnabledSwitch({
  task,
  reason = '',
  busy = false,
  onToggle,
}: {
  task: TaskRecord;
  reason?: string;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <SwitchControl
      title={reason || (task.enabled ? '暂停任务' : '启用任务')}
      checked={task.enabled}
      disabled={!!reason || busy}
      loading={busy}
      aria-label={task.name + '的启用状态'}
      onChange={onToggle}
    />
  );
}
