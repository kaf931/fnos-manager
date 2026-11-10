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
  pagination: `import React from 'react';export default function Pagination(){return React.createElement('span',null,'pagination');}`,
  checkbox: `import React from 'react';export default function Checkbox({children,onChange,...props}){return React.createElement('label',null,React.createElement('input',{...props,type:'checkbox',onChange}),children);}`,

  dropdown: `import React from 'react';const Dropdown=({children,render})=>React.createElement('div',null,children,render);Dropdown.Menu=({children})=>React.createElement('div',null,children);Dropdown.Item=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);export default Dropdown;`,
  'native-select.js': `import React from 'react';export function NativeSelect({optionList,onChange,...props}){return React.createElement('select',{...props,onChange:e=>onChange(e.target.value)},optionList.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)))}`,
  'pull-refresh.js': `export const PullRefresh=({children})=>children;`,
  'switch-control.js': `import React from 'react';export function SwitchControl({onChange,loading,...p}){return React.createElement('input',{...p,type:'checkbox',onChange})}`,
  'terminal-connections.js': `import React from 'react';export function ConnectionCards({rows,onAction,options}){return rows.map(row=>React.createElement('article',{key:row.id,className:'card'},React.createElement('h3',null,row.name),options.metaControl(row),...['connect','edit','delete'].map(a=>React.createElement('button',{key:a,onClick:()=>onAction(a,row)},a==='connect'?'测试通知':a==='edit'?'编辑模板':'删除模板'))))}`,
  'confirmation.js': `export const confirmAction=async(options)=>{await options.onAccept?.();return true;};`,
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
        b.onResolve({ filter: /@douyinfe\/semi-ui\/lib\/es\/(pagination|checkbox)$/ }, (a) => ({
          path: a.path.split('/').at(-1),
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
  await act(() => button('配置 通用 Webhook').click());
  assert.ok(document.querySelector('dialog[data-react-dialog]'));
  assert.equal(document.querySelector('#notification-channel'), null);
  assert.equal(document.querySelector('#notification-token').autocomplete, 'new-password');
  assert.equal(document.querySelector('#notification-url').name, 'notification-endpoint');
  await act(() => button('取消').click());
  await act(() => button('配置 邮箱（SMTP）').click());
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
  await act(() => button('配置 通用 Webhook').click());
  assert.ok(document.querySelector('#notification-name'));
  await act(() => button('取消').click());
  assert.equal(document.querySelector('input[aria-label="搜索提醒事项"]'), search);
  assert.equal(search.value, 'Keep query');
});

test('editing an unavailable channel starts with empty safe configuration and preserves its name', async (t) => {
  const row = {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    id: 'old',
    name: 'Old template',
    channel: 'retired',
    enabled: false,
    url: 'https://old.example/secret',
    token: 'PRIVATE',
    condition: 'all',
    scanFailures: true,
    telegramChatId: 'OLD',
  };
  const f = fixture(t, async (route) =>
    route.endsWith('/templates') ? [row] : route.endsWith('/reminders') ? [] : row,
  );
  await f.open();
  assert.equal(document.querySelector('[aria-label="启用 Old template"]').disabled, true);
  await act(async () => {
    button('编辑 Old template').click();
    await tick();
  });
  assert.equal(document.querySelector('#notification-name').value, 'Old template');
  assert.equal(document.querySelector('#notification-channel'), null);
  assert.equal(button('保存模板').disabled, true);
  assert.equal(document.querySelector('#notification-url').value, '');
  assert.equal(document.querySelector('#notification-token').value, '');
  assert.ok(document.querySelector('dialog').textContent.includes('原通知渠道已移除'));
});

test('eight built-in channel cards open matching unsaved configurations without automatic writes', async (t) => {
  const calls = [];
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return [];
  });
  await f.open();
  const templates = document.querySelector('[aria-label="通知模板"]');
  assert.equal(templates.querySelectorAll('.compact-card').length, 8);
  assert.equal(button('新增模板'), undefined);
  for (const [_channel, label] of [
    ['webhook', '通用 Webhook'],
    ['wecom', '企业微信'],
    ['dingtalk', '钉钉'],
    ['feishu', '飞书'],
    ['email', '邮箱（SMTP）'],
    ['serverchan', '个人微信（Server酱）'],
    ['bark', '手机推送（Bark）'],
    ['inapp', '应用内通知'],
  ]) {
    await act(() => button('配置 ' + label).click());
    assert.equal(document.querySelector('#notification-channel'), null);
    assert.equal(document.querySelector('#notification-name').value, label);
    await act(() => button('取消').click());
  }
  assert.ok(calls.every((c) => !c.method || c.method === 'GET'));
});

test('configured channel replaces its placeholder and keeps multiple saved templates', async (t) => {
  const rows = ['one', 'two'].map((id) => ({
    ...DEFAULT_NOTIFICATION_OPTIONS,
    id,
    name: 'Saved ' + id,
    enabled: false,
    url: 'http://localhost/hook',
    token: '',
    condition: 'all',
    scanFailures: true,
  }));
  const f = fixture(t, async (route) =>
    route.endsWith('/templates') ? rows : route.endsWith('/reminders') ? [] : rows[0],
  );
  await f.open();
  const section = document.querySelector('[aria-label="通知模板"]');
  assert.equal(section.querySelectorAll('.compact-card').length, 9);
  assert.equal(button('配置 通用 Webhook'), undefined);
  assert.ok(button('编辑 Saved one'));
  assert.ok(button('编辑 Saved two'));
  await act(async () => {
    button('编辑 Saved one').click();
    await tick();
  });
  assert.equal(document.querySelector('#notification-name').value, 'Saved one');
});

test('inbox reuses record pagination, marks opened messages read and supports shared batch deletion', async (t) => {
  let read = false,
    removed = false;
  const calls = [];
  const message = {
    id: 'message',
    name: 'Maintenance',
    content: 'Safe <script>text</script>\nFailed',
    createdAt: new Date().toISOString(),
    readAt: null,
    templateName: 'App',
    status: 'success',
  };
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    if (route === '/notifications/inbox/unread') return { count: read || removed ? 0 : 1 };
    if (route.startsWith('/notifications/inbox?'))
      return {
        items: removed ? [] : [{ ...message, readAt: read ? new Date().toISOString() : null }],
        total: removed ? 0 : 1,
      };
    if (route === '/notifications/inbox/read') {
      read = true;
      return { success: true };
    }
    if (route.includes('/storage/cleanup/records/deliveries/delete')) {
      removed = true;
      return { success: true };
    }
    return [];
  });
  await f.open();
  await act(async () => {
    button('应用内消息，1 条未读').click();
    await tick();
  });
  assert.ok(document.querySelector('[aria-label="应用内消息分页"]'));
  await act(async () => {
    button('Maintenance').click();
    await tick();
  });
  assert.ok(
    document.querySelector('.history-run-output').textContent.includes('<script>text</script>'),
  );
  assert.equal(document.querySelector('script'), null);
  assert.equal(read, true);
  await act(async () => {
    button('返回消息').click();
    await tick();
  });
  await act(() =>
    Simulate.change(document.querySelector('tbody input[type=checkbox]'), {
      target: { checked: true },
    }),
  );
  await act(async () => {
    button('批量删除消息').click();
    await tick();
  });
  assert.ok(
    calls.some(
      (c) =>
        c.route.includes('/storage/cleanup/records/deliveries/delete') &&
        c.body.ids[0] === 'message',
    ),
  );
});

test('template strip uses left and right edge controls, fading shared scrollbar and edge-aware scrolling', async (t) => {
  const f = fixture(t, async () => []);
  await f.open();
  const strip = document.querySelector('.compact-card-strip');
  Object.defineProperties(strip, {
    clientWidth: { value: 300, configurable: true },
    scrollWidth: { value: 1000, configurable: true },
  });
  await act(() => Simulate.scroll(strip));
  const next = button('向右查看更多通知模板'),
    previous = button('向左查看更多通知模板');
  assert.ok(next && previous);
  assert.equal(next.hidden, false);
  assert.equal(previous.hidden, true);
  assert.equal(strip.classList.contains('scrollbar-visible'), false);
  let distance = 0;
  strip.scrollBy = ({ left }) => {
    distance = left;
    strip.scrollLeft = Math.max(0, Math.min(700, strip.scrollLeft + left));
    Simulate.scroll(strip);
  };
  await act(() => next.click());
  assert.ok(distance > 0);
  assert.equal(previous.hidden, false);
  assert.equal(next.hidden, false);
  strip.scrollLeft = 700;
  await act(() => Simulate.scroll(strip));
  assert.equal(next.hidden, true);
  assert.equal(previous.hidden, false);
  await act(() => previous.click());
  assert.ok(distance < 0);
  assert.equal(next.hidden, false);
  strip.scrollLeft = 0;
  Object.defineProperty(strip, 'scrollWidth', { value: 300, configurable: true });
  await act(() => Simulate.scroll(strip));
  assert.equal(next.hidden, true);
  assert.equal(previous.hidden, true);
});

test('vertical wheel scrolls the template row, respects boundaries and preserves native gestures', async (t) => {
  const f = fixture(t, async () => []);
  await f.open();
  const strip = document.querySelector('.compact-card-strip');
  Object.defineProperties(strip, {
    clientWidth: { value: 300, configurable: true },
    scrollWidth: { value: 1000, configurable: true },
  });
  const movements = [];
  strip.scrollBy = (options) => {
    movements.push(options);
    strip.scrollLeft = Math.max(0, Math.min(700, strip.scrollLeft + options.left));
    Simulate.scroll(strip);
  };
  async function wheel(options) {
    const event = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
    await act(() => strip.dispatchEvent(event));
    return event.defaultPrevented;
  }
  assert.equal(await wheel({ deltaY: 120 }), true);
  assert.equal(strip.scrollLeft, 120);
  assert.equal(movements[0].behavior, 'auto');
  assert.equal(await wheel({ deltaY: -60 }), true);
  assert.equal(strip.scrollLeft, 60);
  for (const options of [
    { deltaY: 20, ctrlKey: true },
    { deltaY: 20, metaKey: true },
    { deltaY: 20, shiftKey: true },
    { deltaX: 30, deltaY: 20 },
  ])
    assert.equal(await wheel(options), false);
  assert.equal(strip.scrollLeft, 60);
  strip.scrollLeft = 700;
  assert.equal(await wheel({ deltaY: 120 }), false);
  strip.scrollLeft = 0;
  assert.equal(await wheel({ deltaY: -120 }), false);
  assert.equal(await wheel({ deltaY: 1, deltaMode: 2 }), true);
  assert.equal(strip.scrollLeft, 300);
  Object.defineProperty(strip, 'scrollWidth', { value: 300, configurable: true });
  strip.scrollLeft = 0;
  assert.equal(await wheel({ deltaY: 120 }), false);
});

test('all templates dialog uses shared cards and returns after editing without stacked dialogs', async (t) => {
  const f = fixture(t, async () => []);
  await f.open();
  await act(() => button('全部模板').click());
  let dialog = document.querySelector('dialog');
  assert.equal(dialog.dataset.dialogSize, 'large');
  assert.equal(dialog.querySelectorAll('.cards .compact-card').length, 8);
  await act(() => dialog.querySelector('[aria-label="配置 邮箱（SMTP）"]').click());
  assert.equal(document.querySelectorAll('dialog').length, 1);
  assert.ok(document.querySelector('#smtp-user'));
  assert.equal(document.querySelector('#notification-channel'), null);
  await act(() => button('取消').click());
  dialog = document.querySelector('dialog');
  assert.equal(dialog.querySelectorAll('.cards .compact-card').length, 8);
  await act(() => dialog.querySelector('[aria-label="关闭"]').click());
  assert.equal(document.querySelector('dialog'), null);
});
