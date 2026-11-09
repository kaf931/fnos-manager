import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';

async function compile(source, stub = {}) {
  const built = await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    write: false,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    packages: 'external',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'feature-boundaries',
        setup(b) {
          b.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
          b.onResolve({ filter: /\.js$/ }, (args) => {
            const key = args.path.split('/').at(-1);
            return key in stub ? { path: key, namespace: 'fixture' } : undefined;
          });
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: stub[args.path],
          }));
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
  return compiled.exports;
}
const {
  createFileOperations,
  createFileUploadHandlers,
  ConnectionEditor,
  RemoteConnectionPage,
  ConfirmationHost,
} = await compile(
  `
export {createFileOperations} from './web/terminal-file-operations.ts';
export {createFileUploadHandlers} from './web/terminal-file-uploads.ts';
export {ConnectionEditor} from './web/features/terminal/connection-editor.tsx';
export {RemoteConnectionPage} from './web/features/terminal/page.tsx';
export {ConfirmationHost} from './web/confirmation.tsx';
`,
  {
    ...Object.fromEntries(
      [
        'terminal-assets',
        'terminal-command-library',
        'terminal-transfers',
        'terminal-monitor',
        'terminal-ai',
      ].map((name) => [
        name + '.js',
        'export function ' +
          {
            'terminal-assets': 'TerminalAssets',
            'terminal-command-library': 'TerminalCommandLibrary',
            'terminal-transfers': 'TerminalTransfers',
            'terminal-monitor': 'TerminalMonitor',
            'terminal-ai': 'TerminalAi',
          }[name] +
          '(){return null}',
      ]),
    ),
    'terminal-connections.js': `import React from 'react';export function ConnectionCards({rows,onAction}){return rows.map(c=>React.createElement('div',{key:c.id},['connect','edit','delete'].map(action=>React.createElement('button',{key:action,'data-action':action,'data-id':c.id,onClick:()=>onAction(action,c)},action))));}`,
    ...Object.fromEntries(
      ['terminal-view.js', 'remote-desktop.js', 'rdp-desktop.js', 'adb-session.js'].map((name) => [
        name,
        `import React from 'react';export function ${name === 'terminal-view.js' ? 'TerminalSession' : name === 'rdp-desktop.js' ? 'RdpSession' : name === 'adb-session.js' ? 'AdbSession' : 'DesktopSession'}({connection,register,onSession}){React.useEffect(()=>{globalThis.__remotePage.mounts.push(connection.id);register({disconnect:async()=>{globalThis.__remotePage.disconnects.push(connection.id);await globalThis.__remotePage.pending?.promise;},insertCommand:()=>false});onSession({id:connection.id,generation:1,connected:true});return()=>{register(null);globalThis.__remotePage.unmounts.push(connection.id);};},[]);return React.createElement('div',{'data-session':connection.id});}`,
      ]),
    ),
    'native-select.js': `import React from 'react';export function NativeSelect({optionList,onChange,...props}){return React.createElement('select',{...props,onChange:e=>onChange(e.target.value)},optionList.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)));}`,
  },
);

function filesFixture() {
  const pending = deferred(),
    calls = [],
    session = { id: 'one', generation: 1, connected: true };
  const source = { session, path: '/home', sequence: 1 };
  const options = {
    busy: false,
    session,
    current: { current: session },
    directory: { current: '/home' },
    seq: { current: 1 },
    data: { path: '/home', entries: [] },
    taskEpoch: { current: 0 },
    pendingUpload: { current: source },
    upload: { current: null },
    calculating: null,
    valid: (s) => s.id === session.id && s.generation === session.generation,
    confirm: async () => true,
    setBusy() {},
    setError() {},
    setProgress() {},
    setOperationStatus() {},
    setCalculating() {},
    setSizes() {},
    toast() {},
    load: async (path) => calls.push(path),
    fileApi: { action: () => pending.promise, upload: () => pending.promise },
  };
  return { pending, calls, source, options };
}
for (const kind of ['delete', 'upload', 'folder']) {
  test(`${kind} completion preserves a directory selected while the operation was running`, async () => {
    const f = filesFixture();
    const work =
      kind === 'delete'
        ? createFileOperations(f.options).action(
            'delete',
            { name: 'old.txt', type: 'file' },
            f.source,
          )
        : createFileUploadHandlers(f.options)[kind === 'folder' ? 'selectedFolder' : 'selected']({
            target: {
              files: [{ name: 'one.txt', size: 1, webkitRelativePath: 'project/one.txt' }],
              value: '',
            },
          });
    await Promise.resolve();
    f.options.directory.current = '/another';
    f.options.seq.current++;
    f.pending.resolve();
    await work;
    assert.deepEqual(f.calls, []);
  });
}

test('connection authentication controls are locked while saving', async (t) => {
  const ui = remoteFixture(t),
    pending = deferred();
  let saved = 0,
    closed = 0;
  await ui.render(ConnectionEditor, {
    connection: {
      id: 'one',
      name: 'NAS',
      protocol: 'ssh',
      host: 'nas',
      port: 22,
      username: 'root',
      hasCredentials: true,
      authMethod: 'password',
    },
    api: () => pending.promise,
    toast() {},
    onClose() {
      closed++;
    },
    onSave() {
      saved++;
    },
  });
  await act(() =>
    ui.document
      .querySelector('form')
      .dispatchEvent(
        new ui.document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
      ),
  );
  assert.ok(
    [...ui.document.querySelectorAll('[name=terminal-auth-method]')].every((r) => r.disabled),
  );
  await act(async () => pending.resolve({}));
  assert.equal(saved, 1);
  assert.equal(closed, 1);
});

async function pageFixture(t) {
  const ui = remoteFixture(t);
  const state = { mounts: [], unmounts: [], disconnects: [], pending: null };
  globalThis.__remotePage = state;
  t.after(() => {
    delete globalThis.__remotePage;
  });
  const rows = [
    {
      id: 'second',
      name: 'Other',
      host: 'other',
      port: 22,
      username: 'root',
      hasCredentials: true,
      authMethod: 'password',
    },
    {
      id: 'ssh',
      name: 'NAS',
      host: 'nas',
      port: 22,
      username: 'root',
      hasCredentials: true,
      authMethod: 'password',
    },
  ];
  const props = {
    active: true,
    state: { csrfToken: '' },
    services: {
      api: async (path) => (path === '/terminal/connections' ? rows : []),
      toast() {},
    },
  };
  function Page(props) {
    return createElement(
      'div',
      null,
      createElement(RemoteConnectionPage, props),
      createElement(ConfirmationHost),
    );
  }
  await ui.render(Page, props);
  assert.ok(ui.document.querySelector('#terminal-connections[data-scroll-inset]'));
  const click = async (selector) => {
    await act(async () => ui.document.querySelector(selector).click());
  };
  await click('[data-action=connect][data-id=ssh]');
  return { ...ui, state, props, Page, click };
}

test('React connection page keeps sessions mounted while navigating and disconnects before editing', async (t) => {
  const ui = await pageFixture(t);
  await ui.render(ui.Page, { ...ui.props, active: false });
  await ui.render(ui.Page, ui.props);
  assert.deepEqual(ui.state.mounts, ['ssh']);
  assert.deepEqual(ui.state.disconnects, []);
  await ui.click('#terminal-back');
  await ui.click('[data-action=edit][data-id=ssh]');
  await ui.click('[data-cancel]');
  assert.deepEqual(ui.state.disconnects, []);
  await ui.click('[data-action=edit][data-id=ssh]');
  ui.state.pending = deferred();
  await ui.click('[data-accept]');
  assert.equal(ui.document.querySelector('#terminal-editor'), null);
  assert.deepEqual(ui.state.disconnects, ['ssh']);
  await act(async () => ui.state.pending.resolve());
  assert.ok(ui.document.querySelector('#terminal-editor'));
  assert.deepEqual(ui.state.unmounts, ['ssh']);
});

test('React connection tabs wait for disconnect and release only the closed session', async (t) => {
  const ui = await pageFixture(t);
  await ui.click('#terminal-back');
  await ui.click('[data-action=connect][data-id=second]');
  ui.state.pending = deferred();
  await ui.click('.terminal-tab-close');
  await ui.click('[data-accept]');
  assert.ok(ui.document.querySelector('[data-session=ssh]'));
  assert.deepEqual(ui.state.disconnects, ['ssh']);
  await act(async () => ui.state.pending.resolve());
  assert.equal(ui.document.querySelector('[data-session=ssh]'), null);
  assert.deepEqual(ui.state.unmounts, ['ssh']);
  assert.equal(!!ui.document.querySelector('[data-session=second]'), true);
});

test('repeated connection edit clicks share one confirmation', async (t) => {
  const ui = await pageFixture(t);
  await ui.click('#terminal-back');
  await ui.click('[data-action=edit][data-id=ssh]');
  await ui.click('[data-action=edit][data-id=ssh]');
  await ui.click('[data-cancel]');
  assert.equal(!!ui.document.querySelector('.confirmation-dialog'), false);
});

test('an editing continuation cannot open an editor after the connection page unmounts', async (t) => {
  const ui = await pageFixture(t);
  await ui.click('#terminal-back');
  await ui.click('[data-action=edit][data-id=ssh]');
  ui.state.pending = deferred();
  await ui.click('[data-accept]');
  await ui.unmount();
  await act(async () => ui.state.pending.resolve());
  assert.equal(!!ui.document.querySelector('#terminal-editor'), false);
  assert.deepEqual(ui.state.unmounts, ['ssh']);
});
