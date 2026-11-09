import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { remoteFixture } from './helpers/remote-react-fixture.js';
const built = await build({
  entryPoints: ['web/terminal-workspace.tsx'],
  write: false,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  packages: 'external',
  plugins: [
    {
      name: 'workspace-feature-boundaries',
      setup(b) {
        b.onResolve(
          {
            filter:
              /\/(terminal-view|remote-desktop|rdp-desktop|adb-session|terminal-assets|terminal-command-library|terminal-transfers|terminal-monitor|terminal-ai)\.js$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          const name = {
            'terminal-view': 'TerminalSession',
            'remote-desktop': 'DesktopSession',
            'rdp-desktop': 'RdpSession',
            'adb-session': 'AdbSession',
            'terminal-assets': 'TerminalAssets',
            'terminal-command-library': 'TerminalCommandLibrary',
            'terminal-transfers': 'TerminalTransfers',
            'terminal-monitor': 'TerminalMonitor',
            'terminal-ai': 'TerminalAi',
          }[args.path.split('/').at(-1).replace('.js', '')];
          return {
            contents: `import React from 'react';export function ${name}(props){React.useEffect(()=>{if(props.connection)props.onSession?.({id:'session-'+props.connection.id,generation:1,connected:true});},[]);return React.createElement('aside',{'data-feature':'${name}','data-target':props.target?.id,hidden:!props.open});}`,
          };
        });
      },
    },
  ],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { TerminalWorkspace } = compiled.exports;
test('workspace React navigation selects one panel and collapses its selected item', async (t) => {
  const ui = remoteFixture(t);
  await ui.render(TerminalWorkspace, {
    api: async () => [],
    toast() {},
    state: { csrfToken: '' },
    tabs: [],
    selectedId: null,
    active: true,
    onBack() {},
    onSelect() {},
    onClose() {},
    onEdit() {},
    onOpen() {},
    onChanged() {},
    onRegister() {},
    revision: 0,
  });
  const asset = ui.document.querySelector('#terminal-assets-toggle'),
    commands = ui.document.querySelector('#terminal-commands-toggle'),
    ai = ui.document.querySelector('#terminal-ai-toggle');
  await act(() => asset.click());
  assert.equal(asset.getAttribute('aria-pressed'), 'true');
  assert.equal(ui.document.querySelector('[data-feature=TerminalAssets]').hidden, false);
  await act(() => commands.click());
  assert.equal(asset.getAttribute('aria-pressed'), 'false');
  assert.equal(commands.getAttribute('aria-pressed'), 'true');
  await act(() => ai.click());
  assert.equal(commands.getAttribute('aria-pressed'), 'false');
  assert.equal(ui.document.querySelector('[data-feature=TerminalAssets]').hidden, true);
  assert.equal(ui.document.querySelector('[data-feature=TerminalAi]').hidden, false);
  await act(() => ai.click());
  assert.equal(ai.getAttribute('aria-pressed'), 'false');
  assert.equal(ui.document.querySelector('[data-feature=TerminalAi]').hidden, true);
});

for (const protocol of ['vnc', 'rdp', 'adb'])
  test(`switching from an SSH-only panel to ${protocol.toUpperCase()} hides its panel resizer`, async (t) => {
    const ui = remoteFixture(t);
    const props = {
      api: async () => [],
      toast() {},
      state: { csrfToken: '' },
      tabs: [
        { key: 1, connection: { id: 'ssh', name: 'SSH', protocol: 'ssh' } },
        { key: 2, connection: { id: protocol, name: protocol.toUpperCase(), protocol } },
      ],
      selectedId: 'ssh',
      active: true,
      onBack() {},
      onSelect() {},
      onClose() {},
      onEdit() {},
      onOpen() {},
      onChanged() {},
      onRegister() {},
      revision: 0,
    };
    await ui.render(TerminalWorkspace, props);
    await act(() => ui.document.querySelector('#terminal-ai-toggle').click());
    assert.equal(!!ui.document.querySelector('.terminal-panel-resizer'), true);
    await ui.render(TerminalWorkspace, { ...props, selectedId: protocol });
    assert.equal(!!ui.document.querySelector('.terminal-panel-resizer'), false);
    await act(() => ui.document.querySelector('#terminal-assets-toggle').click());
    assert.equal(!!ui.document.querySelector('.terminal-panel-resizer'), true);
  });

test('hiding the workspace keeps the selected AI session and stops visible-panel polling', async (t) => {
  const ui = remoteFixture(t);
  const props = {
    api: async () => [],
    toast() {},
    state: { csrfToken: '' },
    tabs: [{ key: 1, connection: { id: 'ssh', name: 'SSH', protocol: 'ssh' } }],
    selectedId: 'ssh',
    active: true,
    onBack() {},
    onSelect() {},
    onClose() {},
    onEdit() {},
    onOpen() {},
    onChanged() {},
    onRegister() {},
    revision: 0,
  };
  await ui.render(TerminalWorkspace, props);
  await act(() => ui.document.querySelector('#terminal-ai-toggle').click());
  assert.equal(
    ui.document.querySelector('[data-feature=TerminalAi]').getAttribute('data-target'),
    'session-ssh',
  );
  await ui.render(TerminalWorkspace, { ...props, active: false });
  const ai = ui.document.querySelector('[data-feature=TerminalAi]');
  assert.equal(ai.getAttribute('data-target'), 'session-ssh');
  assert.equal(ai.hidden, true);
});
