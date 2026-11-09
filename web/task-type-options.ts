import type { TaskCapabilities } from './contracts/tasks.js';
export function taskTypeOptions(capabilities: TaskCapabilities) {
  return capabilities.types.map((type) => {
    const needsAuth = type.support === 'oauth' && !capabilities.connection.connected;
    return {
      value: type.id,
      disabled: !type.available || needsAuth,
      label: `${type.group} · ${type.name}${!type.available ? '（暂不可用）' : needsAuth ? '（需官方授权）' : ''}`,
    };
  });
}
