export const lifecycleActions = Object.freeze({
  install_init: null,
  install_callback: 'install',
  upgrade_init: 'upgrade-check',
  upgrade_callback: 'upgrade',
  uninstall_init: 'uninstall',
  uninstall_callback: null,
  config_init: null,
  config_callback: null,
});

export function createLifecycleHook(name) {
  if (!Object.hasOwn(lifecycleActions, name)) throw new Error('未知生命周期脚本');
  const action = lifecycleActions[name];
  if (!action) return '#!/bin/sh\nexit 0\n';
  const stop = ['upgrade_init', 'uninstall_init'].includes(name)
    ? '"$(dirname "$0")/main" stop\n'
    : '';
  return `#!/bin/sh\nset -eu\n${stop}exec /var/apps/nodejs_v22/target/bin/node "$TRIM_APPDEST/server/lifecycle.js" ${action}\n`;
}
