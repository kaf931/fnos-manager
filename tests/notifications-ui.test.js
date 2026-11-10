import { Simulate } from 'react-dom/test-utils';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_NOTIFICATION_OPTIONS } from '../server/domain/notifications.js';
const stubs = {
  dropdown: `import React from 'react';const Dropdown=({children,render})=>React.createElement('div',null,children,render);Dropdown.Menu=({children})=>React.createElement('div',null,children);Dropdown.Item=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);export default Dropdown;`,
  'native-select.js': `import React from 'react';export function NativeSelect({optionList,onChange,...props}){return React.createElement('select',{...props,onChange:e=>onChange(e.target.value)},optionList.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)))}`,
  'pull-refresh.js': `export const PullRefresh=({children})=>children;`,
  'switch-control.js': `import React from 'react';export function SwitchControl({onChange,loading,...p}){return React.createElement('input',{...p,type:'checkbox',onChange})}`,
  'terminal-connections.js': `import React from 'react';export function ConnectionCards({rows,onAction,options}){return rows.map(row=>React.createElement('article',{key:row.id,className:'card'},React.createElement('h3',null,row.name),options.metaControl(row),...['connect','edit','delete'].map(a=>React.createElement('button',{key:a,onClick:()=>onAction(a,row)},a==='connect'?'测试通知':a==='edit'?'编辑模板':'删除模板'))))}`,
  'confirmation.js': `export const confirmAction=async()=>true;`,
};
const built = await build({
  entryPoints: ['web/notifications.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve({ filter: /@douyinfe\/semi-ui\/lib\/es\/dropdown$/ }, () => ({
          path: 'dropdown',
          namespace: 'stub',
        }));
        b.onResolve({ filter: /\.js$/ }, (a) => {
          const name = a.path.split('/').at(-1);
          if (stubs[name]) return { path: name, namespace: 'stub' };
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
          loader: 'js',
          contents: stubs[a.path],
        }));
      },
    },
  ],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { NotificationSettingsPage } = module.exports;
const tick = () => new Promise((r) => setTimeout(r, 5));
function fixture(t, api) {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const prior = {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const root = createRoot(document.querySelector('main'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [k, v] of Object.entries(prior)) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
  });
  return {
    async open() {
      await act(async () => {
        root.render(React.createElement(NotificationSettingsPage, { api, toast: () => {} }));
        await tick();
      });
    },
  };
}
const button = (text) =>
  [...document.querySelectorAll('button')].find(
    (e) => e.textContent === text || e.getAttribute('aria-label') === text,
  );
test('notification menu uses list toolbar and empty state; editing uses the shared dialog and isolated credential semantics', async (t) => {
  const calls = [];
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return !method || method === 'GET' ? [] : { ...body, id: 'new' };
  });
  await f.open();
  await act(async () => {
    await tick();
  });
  assert.ok(document.querySelector('.terminal-list-view .task-toolbar'));
  assert.ok(document.querySelector('.empty-onboarding .empty-symbol'));
  assert.equal(document.querySelector('#notification-channel'), null);
  await act(() => button('新增模板').click());
  assert.ok(document.querySelector('dialog[data-react-dialog]'));
  const select = document.querySelector('#notification-channel');
  assert.equal(select.options.length, 14);
  assert.equal(document.querySelector('#notification-token').autocomplete, 'new-password');
  assert.equal(document.querySelector('#notification-url').name, 'notification-endpoint');
  await act(() => {
    select.value = 'email';
    Simulate.change(select);
  });
  assert.equal(document.querySelector('#notification-url'), null);
  assert.ok(document.querySelector('#smtp-user'));
  assert.ok(document.querySelector('#smtp-subject'));
  assert.equal(document.querySelector('#notification-headers'), null);
  await act(() => {
    const input = document.querySelector('#notification-name');
    Simulate.change(input, { target: { value: 'Mail' } });
  });
  await act(async () => {
    Simulate.submit(document.querySelector('form'));
    await tick();
  });
  const saved = calls.find((x) => x.method === 'POST');
  assert.equal(saved.body.channel, 'email');
  assert.equal(saved.body.name, 'Mail');
  assert.ok(
    calls.filter((c) => c.route === '/notifications/reminders' && !c.method).length >= 2,
    'saving a template refreshes reminder choices',
  );
  assert.deepEqual(saved.body.headers, {});
  assert.equal(document.querySelector('dialog'), null);
});
test('templates list toggles through scoped endpoint and testing uses only the saved template', async (t) => {
  const row = {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    id: 'one',
    name: 'Webhook',
    enabled: false,
    url: 'http://local',
    condition: 'all',
    scanFailures: true,
    createdAt: '',
    updatedAt: '',
  };
  const calls = [];
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return route.endsWith('/reminders') ? [] : route.endsWith('/templates') ? [row] : row;
  });
  await f.open();
  await act(async () => {
    await tick();
  });
  const toggle = document.querySelector('[aria-label="启用 Webhook"]');
  await act(async () => {
    Simulate.change(toggle);
    await tick();
  });
  assert.deepEqual(
    calls.find((x) => x.method === 'PATCH'),
    { route: '/notifications/templates/one/enabled', method: 'PATCH', body: { enabled: true } },
  );
  await act(async () => {
    button('测试通知').click();
    await tick();
  });
  assert.ok(
    calls.some((x) => x.route === '/notifications/templates/one/test' && x.method === 'POST'),
  );
  await act(async () => {
    button('编辑模板').click();
    await tick();
  });
  assert.equal(document.querySelector('#notification-name').value, 'Webhook');
  await act(async () => {
    Simulate.submit(document.querySelector('form'));
    await tick();
  });
  const update = calls.find((x) => x.method === 'PUT');
  assert.equal(update.body.id, undefined);
  assert.equal(update.body.createdAt, undefined);
  assert.equal(update.body.updatedAt, undefined);
});

test('notification center reminders use shared cards and dialog and submit a note without list metadata', async (t) => {
  const calls = [];
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return !method || method === 'GET' ? [] : { ...body, id: 'note' };
  });
  await f.open();
  await act(async () => {
    await tick();
  });
  assert.ok(document.querySelector('[aria-label="提醒事项"] .task-toolbar'));
  await act(() => button('新增事项').click());
  assert.ok(document.querySelector('dialog[data-react-dialog]'));
  await act(() => {
    Simulate.change(document.querySelector('#reminder-name'), { target: { value: 'Remember' } });
    Simulate.change(document.querySelector('#reminder-content'), { target: { value: 'Memo' } });
  });
  await act(async () => {
    Simulate.submit(document.querySelector('#reminder-form'));
    await tick();
  });
  const note = calls.find((c) => c.method === 'POST');
  assert.equal(note.route, '/notifications/reminders');
  assert.deepEqual(note.body, {
    name: 'Remember',
    content: 'Memo',
    dueAt: null,
    repeat: 'none',
    templateIds: [],
    enabled: false,
  });
});

test('notification overview shows templates above reminders and editing preserves reminder search', async (t) => {
  const f = fixture(t, async () => []);
  await f.open();
  assert.equal(document.querySelector('[role="tablist"]'), null);
  assert.equal(document.querySelector('#notification-entry'), null);
  const templates = document.querySelector('[aria-label="通知模板"]');
  const reminders = document.querySelector('[aria-label="提醒事项"]');
  assert.ok(templates && reminders);
  assert.equal(templates.hidden, false);
  assert.equal(reminders.hidden, false);
  assert.ok(templates.compareDocumentPosition(reminders) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(templates.querySelector('.compact-card-strip'));
  assert.equal(templates.querySelector('.empty-onboarding'), null);
  const search = document.querySelector('input[aria-label="搜索提醒事项"]');
  await act(() => Simulate.change(search, { target: { value: 'Keep query' } }));
  await act(() => button('新增模板').click());
  assert.ok(document.querySelector('#notification-name'));
  await act(() => button('取消').click());
  assert.equal(document.querySelector('input[aria-label="搜索提醒事项"]'), search);
  assert.equal(search.value, 'Keep query');
});
