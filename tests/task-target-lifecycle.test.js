import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function setup(
  t,
  { holdSaves = false, records = [], holdToggle = false, holdReads = false } = {},
) {
  const polls = [],
    readPending = [];
  const browser = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/',
  });
  const replacements = {
    window: browser.window,
    document: browser.window.document,
    Element: browser.window.Element,
    HTMLElement: browser.window.HTMLElement,
    HTMLInputElement: browser.window.HTMLInputElement,
    HTMLSelectElement: browser.window.HTMLSelectElement,
    location: browser.window.location,
    Event: browser.window.Event,
    CustomEvent: browser.window.CustomEvent,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    setInterval: (callback, ms) => {
      if (ms === 4000) polls.push(callback);
      return 0;
    },
  };
  const previous = Object.fromEntries(
    Object.keys(replacements).map((key) => [key, globalThis[key]]),
  );
  Object.assign(globalThis, replacements);
  browser.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  browser.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  let root;
  t.after(() => {
    if (root) flushSync(() => root.unmount());
    browser.window.close();
    Object.assign(globalThis, previous);
  });
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../web/features/tasks/page.tsx', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'themed-controls-boundary',
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
          builder.onResolve({ filter: /native-select\.js$/ }, () => ({
            path: 'select',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /task-history\.js$/ }, () => ({
            path: 'history',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /task-form-controls\.js$/ }, () => ({
            path: 'controls',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /task-pagination\.js$/ }, () => ({
            path: 'pagination',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /task-status\.js$/ }, () => ({
            path: 'status',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /semi-ui\/lib\/es\/switch$/ }, () => ({
            path: 'switch',
            namespace: 'stub',
          }));
          builder.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({
            path: 'semi',
            namespace: 'stub',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            loader: 'js',
            contents:
              path === 'select'
                ? `import React from 'react'; export function NativeSelect({optionList, onChange, ...props}) {return React.createElement('select', {...props, onChange: e => onChange(e.target.value)}, optionList.map(o => React.createElement('option', {key:o.value, value:o.value, disabled:o.disabled}, o.label)))}`
                : path === 'history'
                  ? 'export function TaskHistory(){return null}'
                  : path === 'switch'
                    ? `import React from 'react'; export default function Switch(p){return React.createElement('button', {role:'switch', 'aria-label':p['aria-label'], 'aria-checked':p.checked, disabled:p.disabled, 'aria-busy':p.loading, onClick:()=>p.onChange(!p.checked)}, String(p.checked))}`
                    : path === 'controls'
                      ? 'export function createTaskFormControls(){return ()=>{}}'
                      : path === 'pagination'
                        ? 'export function createTaskPagination(){return ()=>{}}; export function TaskPagination(){return null}'
                        : path === 'status'
                          ? 'export function mountTaskStatus(){}'
                          : 'function Stub(){return null}; Stub.Menu=Stub; Stub.Item=Stub; export default Stub',
          }));
        },
      },
    ],
  });
  const output = new URL(
    `../.web-test/task-target-${process.pid}-${Math.random()}.mjs`,
    import.meta.url,
  );
  await writeFile(output, result.outputFiles[0].text);
  const { TasksPage } = await import(output.href);
  await unlink(output);
  const officialWrites = [],
    pending = [],
    writes = [],
    saves = [],
    toggles = [],
    messages = [];
  let reads = 0;
  const caps = {
    types: ['app', 'docker', 'script', 'device-wake', 'device-reboot'].map((id) => ({
      id,
      name: id,
      available: true,
      ready: true,
      support: 'native',
    })),
    connection: { connected: true },
  };
  root = createRoot(document.querySelector('#root'));
  flushSync(() =>
    root.render(
      React.createElement(TasksPage, {
        active: true,
        state: { native: true },
        services: {
          toast(message) {
            messages.push(message);
          },
          api: async (route, method, body) => {
            if (route === '/official/status') return { connected: false };
            if (route === '/official/authorize') {
              officialWrites.push(body);
              return new Promise((resolve, reject) => saves.push({ resolve, reject }));
            }
            if (route.startsWith('/tasks/') && method === 'PUT') {
              writes.push(body);
              if (holdToggle)
                await new Promise((resolve, reject) => toggles.push({ resolve, reject }));
              records = records.map((task) =>
                task.id === route.split('/').pop() ? { ...task, ...body } : task,
              );
              return {};
            }
            if (route === '/tasks' && method === 'POST') {
              writes.push(body);
              if (holdSaves)
                return new Promise((resolve, reject) => saves.push({ resolve, reject }));
              return {};
            }
            if (route === '/tasks') {
              reads++;
              if (holdReads)
                return new Promise((resolve, reject) => readPending.push({ resolve, reject }));
              return records.map((task) => ({ ...task }));
            }
            if (route === '/task-capabilities') return caps;
            if (
              route === '/programs' ||
              route === '/containers' ||
              route.startsWith('/task-device-options')
            )
              return new Promise((resolve, reject) => pending.push({ route, resolve, reject }));
            throw Error(route);
          },
        },
      }),
    ),
  );
  await tick();
  const get = (selector) => document.querySelector(selector);
  const open = async () => {
    get('#new-task').click();
    await tick();
  };
  const change = async (type) => {
    get('#task-type').value = type;
    get('#task-type').dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  };
  const submit = async () => {
    get('#task-name').value = 'test';
    get('#task-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await tick();
  };
  return {
    get,
    open,
    change,
    submit,
    caps,
    pending,
    writes,
    officialWrites,
    saves,
    toggles,
    messages,
    reads: () => reads,
    poll: () => polls[0](),
    readPending,
  };
}

test('task targets keep the current type when app and docker responses arrive in reverse order', async (t) => {
  const ui = await setup(t);
  await ui.open();
  await ui.change('docker');
  ui.pending[1].resolve([{ id: 'container-1', name: 'Container' }]);
  await tick();
  ui.pending[0].resolve([{ id: 'program-1', name: 'Program' }]);
  await tick();
  assert.equal(ui.get('#task-target').value, 'container-1');
  await ui.submit();
  assert.equal(ui.writes[0].target, 'container-1');
});

test('closing and reopening the same task type invalidates the previous target request', async (t) => {
  const ui = await setup(t);
  await ui.open();
  ui.get('#task-editor .dialog-close').click();
  await tick();
  await ui.open();
  ui.pending[0].resolve([{ id: 'old-program', name: 'Old' }]);
  await tick();
  assert.equal(ui.get('#save-task').disabled, true);
  assert.equal(ui.get('#task-target').value, '');
  ui.pending[1].resolve([{ id: 'new-program', name: 'New' }]);
  await tick();
  assert.equal(ui.get('#save-task').disabled, false);
  assert.equal(ui.get('#task-target').value, 'new-program');
});

test('target loading, failure and empty lists prevent submission, and changing type recovers', async (t) => {
  const ui = await setup(t);
  await ui.open();
  await ui.submit();
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.get('#save-task').disabled, true);
  ui.pending[0].reject(Error('target read failed'));
  await tick();
  await ui.submit();
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.get('#save-task').disabled, true);
  await ui.change('docker');
  ui.pending[1].resolve([]);
  await tick();
  await ui.submit();
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.get('#save-task').disabled, true);
  await ui.change('script');
  assert.equal(ui.get('#save-task').disabled, false);
});

test('saving a task prevents close and duplicate submits until the request completes', async (t) => {
  const ui = await setup(t, { holdSaves: true });
  await ui.open();
  await ui.change('script');
  await ui.submit();
  await ui.submit();
  assert.equal(ui.writes.length, 1);
  ui.get('#task-editor .dialog-close').click();
  await tick();
  assert.ok(ui.get('#task-editor'));
  ui.saves[0].resolve({});
  await tick();
  assert.equal(ui.get('#task-editor'), null);
});

const taskFixture = (enabled = false) => ({
  id: 'task-switch',
  name: 'Switch task',
  type: 'script',
  enabled,
  schedule: { kind: 'daily', time: '03:00' },
  script: 'echo test',
  running: false,
  lastRun: null,
  nextRunAt: null,
});
for (const result of ['success', 'failure']) {
  test(`task table switch ${result} guards duplicate submissions and retains server state`, async (t) => {
    const ui = await setup(t, { records: [taskFixture()], holdToggle: true });
    const toggle = () => ui.get('#task-rows [role="switch"]');
    assert.equal(toggle().getAttribute('aria-checked'), 'false');
    toggle().click();
    await tick();
    assert.equal(toggle().disabled, true);
    toggle().click();
    assert.equal(ui.writes.length, 1);
    assert.equal(ui.writes[0].enabled, true);
    assert.equal(toggle().getAttribute('aria-checked'), 'false');
    if (result === 'success') ui.toggles[0].resolve();
    else ui.toggles[0].reject(Error('toggle failed'));
    await tick();
    assert.equal(toggle().disabled, false);
    assert.equal(toggle().getAttribute('aria-checked'), String(result === 'success'));
    if (result === 'failure') assert.ok(ui.messages.includes('toggle failed'));
  });
}
test('task editor removes enable control and preserves an existing enabled task on save', async (t) => {
  const ui = await setup(t, { records: [taskFixture(true)] });
  assert.equal(ui.get('#task-enabled'), null);
  ui.get('#task-rows [data-task-action="edit"]').click();
  await tick();
  await ui.submit();
  assert.equal(ui.writes[0].enabled, true);
});
test('new task is saved paused without an enable field', async (t) => {
  const ui = await setup(t);
  await ui.open();
  await ui.change('script');
  ui.get('#task-script').value = 'echo test';
  await ui.submit();
  assert.equal(ui.writes[0].enabled, false);
});

test('editing a task never substitutes the first program for a removed target', async (t) => {
  const ui = await setup(t, {
    records: [{ ...taskFixture(), type: 'app', target: 'removed', action: 'stop' }],
  });
  ui.get('#task-rows [data-task-action="edit"]').click();
  await tick();
  ui.pending[0].resolve([{ id: 'other-app', name: 'Other app' }]);
  await tick();
  assert.equal(ui.get('#task-target').value, 'removed');
  assert.equal(ui.get('#save-task').disabled, true);
  await ui.submit();
  assert.equal(ui.writes.length, 0);
  ui.get('#task-target').value = 'other-app';
  ui.get('#task-target').dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  await ui.submit();
  assert.equal(ui.writes[0].target, 'other-app');
});

test('task edits send the original revision to reject concurrent changes', async (t) => {
  const updatedAt = '2026-11-01T00:00:00.000Z';
  const ui = await setup(t, { records: [{ ...taskFixture(), updatedAt }] });
  ui.get('#task-rows [data-task-action="edit"]').click();
  await tick();
  await ui.submit();
  assert.equal(ui.writes[0].updatedAt, updatedAt);
});

test('task switch explains missing authorization without sending an update', async (t) => {
  const ui = await setup(t, { records: [taskFixture()] });
  ui.caps.connection.connected = false;
  ui.caps.types.find((type) => type.id === 'script').support = 'oauth';
  ui.get('#reload-tasks').click();
  await tick();
  const toggle = ui.get('#task-rows [role="switch"]');
  assert.equal(toggle.disabled, true);
  assert.match(toggle.parentElement.title, /官方授权/);
  toggle.click();
  assert.equal(ui.writes.length, 0);
});
for (const state of [{ pendingReason: '缺少设备配置' }, { running: true }]) {
  test(`task switch is disabled for ${Object.keys(state)[0]}`, async (t) => {
    const ui = await setup(t, { records: [{ ...taskFixture(), ...state }] });
    assert.equal(ui.get('#task-rows [role="switch"]').disabled, true);
  });
}

test('task device selection rejects stale responses, unavailable devices and power selection above ten', async (t) => {
  const ui = await setup(t);
  await ui.open();
  await ui.change('device-wake');
  await ui.change('device-reboot');
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: 'power-' + i,
    name: 'Device ' + i,
    description: 'root@host',
    available: true,
    target: {
      id: 'power-' + i,
      connectionId: 'ssh',
      system: 'linux',
      host: 'host',
      port: 22,
      username: 'root',
    },
  }));
  ui.pending[2].resolve([
    ...rows,
    { id: 'blocked', name: 'Blocked', description: 'unavailable', available: false },
  ]);
  await tick();
  ui.pending[1].resolve([{ id: 'stale', name: 'Stale', available: true }]);
  await tick();
  assert.doesNotMatch(ui.get('#task-device-fields').textContent, /Stale/);
  ui.get('[aria-label="选择全部任务设备"]').click();
  await tick();
  assert.equal(ui.get('#task-device-fields').querySelectorAll('input:checked').length, 11);
  const inputs = [...ui.get('#task-device-fields').querySelectorAll('label')];
  assert.equal(
    inputs.find((x) => x.textContent.includes('Blocked')).querySelector('input').disabled,
    true,
  );
  assert.match(ui.get('#task-device-fields').textContent, /已选择 10 台/);
});

test('official authorization prevents duplicate requests and closing while authorization is pending', async (t) => {
  const ui = await setup(t);
  ui.get('#open-official').click();
  await tick();
  ui.get('#begin-official').click();
  ui.get('#begin-official').click();
  await tick();
  assert.equal(ui.officialWrites.length, 1);
  ui.get('#official-dialog .dialog-close').click();
  await tick();
  assert.ok(ui.get('#official-dialog'));
  ui.saves[0].resolve({ authorizationUrl: 'https://example.test/auth' });
  await tick();
  assert.ok(ui.get('#official-link'));
});

test('task toolbar exposes common desktop controls and mobile filters with equivalent state', async (t) => {
  const ui = await setup(t, { records: [taskFixture(true)] });
  assert.ok(ui.get('#tasks-page > .task-toolbar'));
  assert.ok(ui.get('#task-mobile-list[data-scroll-inset]'));
  assert.ok(ui.get('#task-status .mobile-toolbar-filter[data-scroll-inset]'));
  assert.ok(ui.get('#task-status .desktop-toolbar-filter select'));
  const filters = [...ui.get('#task-status .mobile-toolbar-filter').querySelectorAll('button')];
  assert.equal(filters.length, 3);
  filters[2].click();
  await tick();
  assert.equal(ui.get('#task-status select').value, 'disabled');
  assert.equal(filters[2].getAttribute('aria-pressed'), 'true');
  assert.equal(ui.get('#task-table-wrap').hidden, true);
  for (const id of ['open-official', 'new-task', 'reload-tasks']) {
    assert.ok(ui.get('#' + id + ' svg'));
    assert.ok(ui.get('#' + id).getAttribute('aria-label'));
  }
  assert.ok(ui.get('#reload-tasks.toolbar-refresh'));
});

test('slow task reads finish before another timer poll starts and a failure can recover', async (t) => {
  const ui = await setup(t, { holdReads: true });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  ui.poll();
  ui.poll();
  await tick();
  assert.equal(ui.reads(), 1);
  ui.readPending[0].resolve([taskFixture()]);
  await tick();
  assert.ok(ui.get('#task-rows [role="switch"]'));
  ui.poll();
  await tick();
  assert.equal(ui.reads(), 2);
  ui.readPending[1].reject(new Error('temporarily slow'));
  await tick();
  ui.poll();
  await tick();
  assert.equal(ui.reads(), 3);
  ui.readPending[2].resolve([taskFixture()]);
  await tick();
  assert.ok(ui.get('#task-rows [role="switch"]'));
});
