import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { mountUi, tick } from './fixtures/react-ui.js';

test('appearance controls use public settings rows, save independent preferences without module tabs', async (t) => {
  const calls = [];
  let preferences = {
    theme: 'system',
    palette: 'classic',
    terminalBackground: 'striped',
    commandHints: true,
    defaultPage: 'icons',
    navigationMotion: true,
  };
  const ui = await mountUi(
    t,
    'system-settings',
    'SettingsPage',
    {
      api: async (url, method, patch) => {
        calls.push({ url, method, patch });
        preferences = { ...preferences, ...patch };
        return preferences;
      },
      toast() {},
      state: { version: '0.3.4' },
      active: true,
      onRestored: async () => {},
    },
    {
      'config-backup': 'export const ConfigBackupDialog=()=>null;',
      'terminal-ai-skills': 'export const AiSkills=()=>null;',
      'terminal-ai-settings': 'export const AiSettings=()=>null;',
      'switch-control': `import React from 'react'; export function SwitchControl(p){return React.createElement('input',{type:'checkbox',checked:p.checked,onChange:e=>p.onChange(e.target.checked)})}`,
    },
  );
  const palette = ui.get('[aria-labelledby="setting-palette"]');
  assert.equal(
    palette.closest('.system-settings-row').querySelector('label').textContent,
    '强调色',
  );
  assert.equal(palette.value, 'classic');
  assert.ok(
    [...palette.options].some(
      (option) => option.value === 'default' && option.textContent === '默认',
    ),
  );
  await act(async () => {
    palette.value = 'mist';
    palette.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.deepEqual(calls.at(-1).patch, { palette: 'mist' });
  const background = ui.get('[aria-labelledby="setting-terminalBackground"]');
  await act(async () => {
    background.value = 'solid';
    background.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  });
  assert.deepEqual(calls.at(-1).patch, { terminalBackground: 'solid' });
  assert.equal(ui.get('[aria-labelledby="setting-palette"]').value, 'mist');
  assert.equal(document.querySelector('nav[aria-label="设置模块"]'), null);
});
