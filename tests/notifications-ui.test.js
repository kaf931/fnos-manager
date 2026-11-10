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
  dnd: `import React from 'react';export const dndBridge={props:null,items:new Map()};export function DragDropProvider(props){dndBridge.props=props;return props.children;}`,
  'dnd-sortable': `import {dndBridge} from '@dnd-kit/react';export function useSortable(input){dndBridge.items.set(input.id,input);return{ref:()=>{},handleRef:()=>{},isDragging:false};}export const isSortable=source=>source?.sortable===true;`,
  'dnd-dom': `class Constraint{constructor(options){this.options=options;}}class Sensor{static configure(options){return{sensor:this,options};}}export const PointerActivationConstraints={Delay:Constraint,Distance:Constraint};export class PointerSensor extends Sensor{}export class KeyboardSensor extends Sensor{}export class Feedback extends Sensor{}`,
  pagination: `import React from 'react';export default function Pagination(){return React.createElement('span',null,'pagination');}`,
  checkbox: `import React from 'react';export default function Checkbox({children,onChange,...props}){return React.createElement('label',null,React.createElement('input',{...props,type:'checkbox',onChange}),children);}`,

  dropdown: `import React from 'react';const Dropdown=({children,render,onVisibleChange,visible,position,spacing})=>React.createElement('div',{'data-dropdown-position':position,'data-dropdown-spacing':JSON.stringify(spacing)},React.cloneElement(children,{onClick:e=>{children.props.onClick?.(e);onVisibleChange?.(!visible);}}),render);Dropdown.Menu=({children})=>React.createElement('div',null,children);Dropdown.Item=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);export default Dropdown;`,
  'native-select.js': `import React from 'react';export function NativeSelect({optionList,onChange,...props}){return React.createElement('select',{...props,onChange:e=>onChange(e.target.value)},optionList.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)))}`,
  'pull-refresh.js': `export const PullRefresh=({children})=>children;`,
  'switch-control.js': `import React from 'react';export function SwitchControl({onChange,loading,...p}){return React.createElement('input',{...p,type:'checkbox',onChange})}`,
  'terminal-connections.js': `import React from 'react';export function ConnectionCards({rows,onAction,options}){return rows.map(row=>React.createElement('article',{key:row.id,className:'card'},React.createElement('h3',null,row.name),React.createElement('span',null,options.tag?.(row)),options.metaControl(row),...['connect','edit','delete'].map(a=>React.createElement('button',{key:a,onClick:()=>onAction(a,row)},a==='connect'?'测试通知':a==='edit'?'编辑模板':'删除模板'))))}`,
  'confirmation.js': `export const confirmAction=async(options)=>{await options.onAccept?.();return true;};`,
};
const built = await build({
  stdin: {
    contents:
      "export {NotificationSettingsPage} from './web/notifications.tsx'; export {NotificationInbox} from './web/notification-inbox.tsx'; export {dndBridge} from '@dnd-kit/react';",
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
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
        b.onResolve({ filter: /^@dnd-kit\/(react(?:\/sortable)?|dom)$/ }, (a) => ({
          path: a.path.endsWith('/sortable')
            ? 'dnd-sortable'
            : a.path.endsWith('/dom')
              ? 'dnd-dom'
              : 'dnd',
          namespace: 'stub',
        }));
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
const { NotificationSettingsPage, NotificationInbox, dndBridge } = module.exports;
const tick = () => new Promise((r) => setTimeout(r, 5));
function fixture(t, api, mobile = false) {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const prior = {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    matchMedia: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }),
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
    async open(Component = NotificationSettingsPage, extra = {}) {
      await act(async () => {
        root.render(React.createElement(Component, { api, toast: () => {}, ...extra }));
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
    if (route.startsWith('/notifications/deliveries?')) return { items: [], total: 0 };
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
  assert.ok(
    calls.some(
      (call) =>
        call.route.includes('/notifications/deliveries?') && call.route.includes('templateId=one'),
    ),
  );
  await act(() => document.querySelector('dialog [aria-label="关闭"]').click());
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
  assert.equal(
    calls.some((c) => c.method === 'POST'),
    false,
  );
  assert.ok(document.querySelector('[role="alert"]').textContent.includes('提醒时间'));
  assert.equal(document.querySelector('input[type="datetime-local"]').required, true);
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
  assert.ok(
    templates.compareDocumentPosition(reminders.querySelector('.cards.connection-cards')) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
  );
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
  const f = fixture(
    t,
    async (route, method, body) => {
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
    },
    false,
  );
  await f.open(NotificationInbox, { active: true });
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
  assert.ok(document.querySelector('.compact-card-strip-shell.desktop-only'));
  assert.equal(dialog.dataset.dialogSize, 'large');
  assert.equal(dialog.querySelectorAll('.cards .compact-card').length, 8);
  const card = dialog.querySelector('.compact-card');
  assert.ok(card.firstElementChild.matches('.sortable-card-handle'));
  assert.ok(card.firstElementChild.nextElementSibling.matches('.compact-card-open'));

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

test('editing a reminder drops unavailable template ids while saving the selected ready template', async (t) => {
  const template = {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    id: 'ready',
    name: 'Ready',
    channel: 'inapp',
    enabled: true,
    ready: true,
  };
  const row = {
    id: 'reminder',
    name: 'Existing',
    content: '',
    dueAt: '2030-11-10T01:00:00.000Z',
    repeat: 'none',
    templateIds: ['deleted', 'ready'],
    enabled: false,
    status: 'open',
    nextAt: null,
    error: null,
  };
  const calls = [];
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return route === '/notifications/templates'
      ? [template]
      : route === '/notifications/reminders'
        ? [row]
        : {};
  });
  await f.open();
  await act(() =>
    [...document.querySelectorAll('[aria-label="提醒事项"] .cards.connection-cards button')]
      .find((e) => e.textContent === '编辑模板')
      .click(),
  );
  await act(async () => {
    Simulate.submit(document.querySelector('#reminder-form'));
    await tick();
  });
  assert.deepEqual(calls.find((c) => c.method === 'PUT').body.templateIds, ['ready']);
});

test('closing template overview ignores a pending template editor response', async (t) => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const row = {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    id: 'slow',
    name: 'Slow',
    channel: 'inapp',
    enabled: false,
    ready: true,
  };
  const f = fixture(t, async (route) =>
    route === '/notifications/templates'
      ? [row]
      : route === '/notifications/templates/slow'
        ? pending
        : [],
  );
  await f.open();
  await act(() => button('全部模板').click());
  await act(() => document.querySelector('dialog [aria-label="编辑 Slow"]').click());
  await act(() => document.querySelector('dialog [aria-label="关闭"]').click());
  await act(async () => {
    resolve(row);
    await tick();
  });
  assert.equal(!!document.querySelector('dialog'), false);
});

test('mobile template and message actions share the reminder add toolbar without duplicate entries', async (t) => {
  const f = fixture(t, async () => [], true);
  await f.open();
  const toolbar = document.querySelector('[aria-label="提醒事项"] .toolbar-actions');
  assert.ok(toolbar.querySelector('[aria-label="全部模板"]'));
  assert.ok(toolbar.querySelector('[aria-label="应用内消息"]'));
  assert.ok(toolbar.querySelector('[aria-label="新增事项"]'));
  assert.equal(document.querySelectorAll('[aria-label="全部模板"]').length, 1);
  assert.ok(
    document.querySelector('section[aria-label="通知模板"]').classList.contains('desktop-only'),
  );
  await act(() => button('全部模板').click());
  assert.equal(document.querySelector('dialog .cards').children.length, 8);
});

test('desktop inbox trigger opens a recent-message menu before opening message details', async (t) => {
  const item = {
    id: 'm1',
    name: 'Desktop message',
    content: 'Body',
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  const calls = [];
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return route.endsWith('/unread')
      ? { count: 1 }
      : route.includes('/inbox?')
        ? { items: [item], total: 1 }
        : {};
  });
  await f.open(NotificationInbox, { active: true, menu: true });
  const layout = document.createElement('div');
  layout.className = 'layout';
  const card = document.createElement('main');
  layout.append(card);
  document.body.append(layout);
  card.getBoundingClientRect = () => ({ left: 200, bottom: 650 });
  button('应用内消息，1 条未读').getBoundingClientRect = () => ({ right: 180, bottom: 630 });
  await act(async () => {
    button('应用内消息，1 条未读').click();
    await tick();
  });
  assert.equal(!!document.querySelector('dialog'), false);
  const menu = document.querySelector('[data-dropdown-position="rightBottom"]');
  assert.ok(menu);
  assert.deepEqual(JSON.parse(menu.dataset.dropdownSpacing), { x: 20, y: 20 });
  assert.ok(
    [...document.querySelectorAll('button')].some(
      (e) => e.textContent.includes('• Desktop message') && e.textContent.includes('Body'),
    ),
  );
  await act(async () => {
    [...document.querySelectorAll('button')]
      .find((e) => e.textContent.includes('• Desktop message'))
      .click();
    await tick();
  });
  assert.ok(document.querySelector('dialog').textContent.includes('Body'));
  assert.ok(calls.some((c) => c.route === '/notifications/inbox/read' && c.body.ids[0] === 'm1'));
});

test('notification center unifies template actions and refresh in the top reminder toolbar', async (t) => {
  const calls = [];
  const f = fixture(t, async (route) => {
    calls.push(route);
    return [];
  });
  await f.open();
  assert.equal(document.querySelectorAll('#notifications-page header.toolbar').length, 1);
  const toolbar = document.querySelector('#notifications-page header.toolbar');
  assert.ok(toolbar.querySelector('[aria-label="全部模板"]'));
  assert.ok(toolbar.querySelector('[aria-label="新增事项"]'));
  const start = calls.length;
  await act(async () => {
    button('刷新通知中心').click();
    await tick();
  });
  assert.ok(calls.slice(start).includes('/notifications/templates'));
  assert.ok(calls.slice(start).includes('/notifications/reminders'));
});

test('one available notification template is preselected for new reminders', async (t) => {
  const template = {
    ...DEFAULT_NOTIFICATION_OPTIONS,
    id: 'only',
    name: 'Only',
    channel: 'inapp',
    enabled: true,
    ready: true,
  };
  const f = fixture(t, async (route) => (route === '/notifications/templates' ? [template] : []));
  await f.open();
  await act(() => button('新增事项').click());
  assert.equal(document.querySelector('.form-check-row:last-of-type input').checked, true);
  assert.equal(
    document.querySelector('[aria-labelledby="reminder-template-label"] input').checked,
    true,
  );
});
test('configuring templates from a reminder preserves its draft and avoids stacked dialogs', async (t) => {
  const f = fixture(t, async () => []);
  await f.open();
  await act(() => button('新增事项').click());
  await act(() =>
    Simulate.change(document.querySelector('#reminder-name'), { target: { value: 'Keep draft' } }),
  );
  await act(() => button('配置通知模板').click());
  assert.equal(document.querySelectorAll('dialog[open]').length, 1);
  assert.ok(document.querySelector('dialog .cards'));
  await act(() => document.querySelector('dialog [aria-label="关闭"]').click());
  assert.equal(document.querySelectorAll('dialog[open]').length, 1);
  assert.equal(document.querySelector('#reminder-name').value, 'Keep draft');
});
test('reminder cards show clear delivery and pause states', async (t) => {
  const rows = [
    { id: 'wait', enabled: true, status: 'open' },
    { id: 'paused', enabled: false, status: 'open' },
    { id: 'done', enabled: false, status: 'completed' },
    { id: 'error', enabled: false, status: 'open', error: '所选通知模板不可用' },
    { id: 'sent', enabled: false, status: 'open', lastFiredAt: '2026-11-10T00:00:00Z' },
  ].map((r) => ({
    name: r.id,
    content: '',
    repeat: 'none',
    dueAt: '2030-11-10T00:00:00Z',
    templateIds: [],
    nextAt: null,
    ...r,
  }));
  const f = fixture(t, async (route) => (route === '/notifications/reminders' ? rows : []));
  await f.open();
  assert.ok(document.body.textContent.includes('待提醒 · 单次提醒'));
  assert.ok(document.body.textContent.includes('已暂停 · 单次提醒'));
  assert.ok(document.body.textContent.includes('模板不可用 · 单次提醒'));
  assert.ok(document.body.textContent.includes('已触发 · 单次提醒'));
});

test('background reminder sync pauses while hidden or editing', async (t) => {
  const nativeSet = globalThis.setInterval,
    nativeClear = globalThis.clearInterval;
  const timers = new Map();
  let id = 0;
  globalThis.setInterval = (callback, delay) => {
    const key = ++id;
    timers.set(key, { callback, delay });
    return key;
  };
  globalThis.clearInterval = (key) => timers.delete(key);
  t.after(() => {
    globalThis.setInterval = nativeSet;
    globalThis.clearInterval = nativeClear;
  });
  let reads = 0;
  const f = fixture(t, async (route) => {
    if (route === '/notifications/reminders') reads++;
    return [];
  });
  await f.open();
  const initial = reads;
  await act(async () => {
    for (const timer of [...timers.values()]) timer.callback();
    await tick();
  });
  assert.ok(reads > initial);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const before = reads;
  await act(async () => {
    for (const timer of [...timers.values()]) timer.callback();
    await tick();
  });
  assert.equal(reads, before);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(() => button('新增事项').click());
  await act(async () => {
    for (const timer of [...timers.values()]) timer.callback();
    await tick();
  });
  assert.equal(reads, before);
});

test('desktop message menu marks all messages read without opening the full list', async (t) => {
  let unread = 2;
  const calls = [];
  const f = fixture(t, async (route, method) => {
    calls.push({ route, method });
    if (route.endsWith('/unread')) return { count: unread };
    if (route.includes('/inbox?')) return { items: [], total: 0 };
    if (route.endsWith('/read-all')) unread = 0;
    return {};
  });
  await f.open(NotificationInbox, { active: true, menu: true });
  await act(async () => {
    button('应用内消息，2 条未读').click();
    await tick();
  });
  await act(async () => {
    button('全部已读').click();
    await tick();
  });
  assert.ok(calls.some((c) => c.route === '/notifications/inbox/read-all' && c.method === 'POST'));
  assert.ok(button('应用内消息'));
  assert.equal(!!document.querySelector('dialog'), false);
});
test('message entry points share one unread polling subscription per API', async (t) => {
  let reads = 0;
  const f = fixture(t, async (route) => {
    if (route.endsWith('/unread')) reads++;
    return { count: 0 };
  });
  function Pair(props) {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(NotificationInbox, { ...props, active: true }),
      React.createElement(NotificationInbox, { ...props, active: true }),
    );
  }
  await f.open(Pair);
  assert.equal(reads, 1);
});

test('reopening notification center keeps loaded template titles enabled during refresh', async (t) => {
  let delay = false,
    resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const f = fixture(t, async (route) =>
    delay && route === '/notifications/templates' ? pending : [],
  );
  await f.open();
  assert.equal(button('配置 通用 Webhook').disabled, false);
  await f.open(NotificationSettingsPage, { active: false });
  delay = true;
  await f.open(NotificationSettingsPage, { active: true });
  assert.equal(button('配置 通用 Webhook').disabled, false);
  assert.ok(document.querySelector('.empty-onboarding'));
  await act(async () => {
    resolve([]);
    await tick();
  });
});
test('reminder batch menu uses selected ids with the shared batch endpoint', async (t) => {
  const calls = [],
    row = {
      id: 'batch-one',
      name: 'Batch one',
      content: '',
      status: 'open',
      enabled: false,
      repeat: 'none',
      dueAt: '2030-11-10T00:00:00Z',
      nextAt: null,
      templateIds: [],
    };
  const f = fixture(t, async (route, method, body) => {
    calls.push({ route, method, body });
    return route === '/notifications/reminders' ? [row] : [];
  });
  await f.open();
  await act(() => button('批量管理提醒').click());
  await act(() => document.querySelector('[aria-label="选择 Batch one"]').click());
  await act(async () => {
    button('执行').click();
    await tick();
  });
  assert.ok(
    calls.some(
      (call) =>
        call.route === '/notifications/reminders/batch' &&
        call.body.action === 'complete' &&
        call.body.ids[0] === 'batch-one',
    ),
  );
});

test('inbox search submits a scoped encoded query', async (t) => {
  const calls = [];
  const f = fixture(t, async (route) => {
    calls.push(route);
    return route.endsWith('/unread') ? { count: 0 } : { items: [], total: 0 };
  });
  await f.open(NotificationInbox, { active: true });
  await act(async () => {
    button('应用内消息').click();
    await tick();
  });
  await act(async () => {
    Simulate.change(document.querySelector('[aria-label="搜索消息"]'), {
      target: { value: '测试 100%' },
    });
    await tick();
  });
  assert.ok(calls.some((route) => route.includes('&q=' + encodeURIComponent('测试 100%'))));
});

// Exercise the persistence boundary with dnd-kit completion events. Real gestures,
// layout and Web Animations are verified in a browser, not simulated by JSDOM.
async function finishSort(from, to, { canceled = false, target = true } = {}) {
  await act(async () => {
    dndBridge.props.onDragEnd({
      canceled,
      operation: {
        source: {
          id: from,
          initialIndex: dndBridge.items.get(from).index,
          index: dndBridge.items.get(to).index,
          sortable: true,
        },
        target: target ? {} : null,
      },
    });
    await tick();
  });
}
const sortedIds = () =>
  [...document.querySelectorAll('.cards > [data-sortable-id]')].map((e) => e.dataset.sortableId);

test('dnd-kit completion persists shared template order and failed saves restore it', async (t) => {
  let saved = [],
    fail = false;
  const f = fixture(t, async (route, method, body) => {
    if (route.endsWith('/template-order')) {
      if (method === 'PUT') {
        if (fail) throw new Error('save failed');
        saved = body.keys;
      }
      return { keys: saved };
    }
    return [];
  });
  await f.open();
  await act(() => button('全部模板').click());
  const initial = sortedIds();
  assert.equal(document.querySelector('.sortable-card-handle').draggable, false);
  await finishSort(initial[0], initial[3]);
  assert.equal(saved[3], initial[0]);
  assert.deepEqual(saved, sortedIds());
  const prior = sortedIds();
  fail = true;
  await finishSort(prior[0], prior[2]);
  assert.deepEqual(sortedIds(), prior);
  assert.deepEqual(
    [...document.querySelectorAll('.compact-card-strip .compact-card strong')].map(
      (e) => e.textContent,
    ),
    [...document.querySelectorAll('.cards .compact-card strong')].map((e) => e.textContent),
  );
});

test('canceled and outside drops do not save; animation and sensor configuration preserve touch and keyboard access', async (t) => {
  let writes = 0;
  const f = fixture(
    t,
    async (route, method) => {
      if (method === 'PUT') writes++;
      return route.endsWith('/template-order') ? { keys: [] } : [];
    },
    true,
  );
  await f.open();
  await act(() => button('全部模板').click());
  const initial = sortedIds();
  await finishSort(initial[0], initial[3], { canceled: true });
  await finishSort(initial[0], initial[3], { target: false });
  assert.equal(writes, 0);
  assert.deepEqual(sortedIds(), initial);
  const config = dndBridge.items.get(initial[0]);
  assert.equal(config.transition.duration, 220);
  const plugins = config.plugins([]);
  assert.equal(plugins[0].options.feedback, 'clone');
  assert.equal(plugins[0].options.dropAnimation.duration, 220);
  const sensors = dndBridge.props.sensors;
  assert.equal(sensors.length, 2);
  assert.equal(
    sensors[0].options.activationConstraints({ pointerType: 'touch' })[0].options.value,
    250,
  );
  assert.equal(
    sensors[0].options.activationConstraints({ pointerType: 'mouse' })[0].options.value,
    5,
  );
  assert.match(document.querySelector('.sortable-card-handle').title, /Esc/);
});

test('pending template sorting stays consistent after leaving and returning', async (t) => {
  let server = [],
    release;
  const api = async (route, method, body) => {
    if (route.endsWith('/template-order')) {
      if (method === 'PUT')
        return new Promise((resolve) => {
          release = () => {
            server = body.keys;
            resolve({ keys: server });
          };
        });
      return { keys: server };
    }
    return [];
  };
  const f = fixture(t, api);
  await f.open();
  await act(() => button('全部模板').click());
  const initial = sortedIds();
  await finishSort(initial[0], initial[3]);
  const expected = sortedIds();
  await f.open(NotificationSettingsPage, { active: false });
  await f.open(NotificationSettingsPage, { active: true });
  await act(() => button('全部模板').click());
  await act(async () => {
    release();
    await tick();
  });
  assert.deepEqual(server, expected);
  assert.deepEqual(sortedIds(), server);
});

test('all templates shows initial loading failure inside the dialog and retries without fake unconfigured cards', async (t) => {
  let fails = true;
  const f = fixture(t, async (route) => {
    if (route.endsWith('/templates') && fails) throw Error('模板读取失败');
    return route.endsWith('/template-order') ? { keys: [] } : [];
  });
  await f.open();
  await act(() => button('全部模板').click());
  assert.match(document.querySelector('dialog [role="alert"]')?.textContent || '', /模板读取失败/);
  assert.equal(document.querySelectorAll('dialog .compact-card').length, 0);
  assert.equal(document.querySelectorAll('[aria-label="通知模板"] .compact-card').length, 0);
  fails = false;
  await act(async () => {
    button('重试读取通知模板').click();
    await tick();
  });
  assert.equal(document.querySelector('dialog [role="alert"]'), null);
  assert.equal(document.querySelectorAll('dialog .compact-card').length, 8);
  assert.doesNotMatch(document.body.textContent, /模板读取失败/);
});

test('opening multiple messages queues and deduplicates read requests while the first one is pending', async (t) => {
  const readIds = [];
  let release;
  const messages = ['a', 'b'].map((id) => ({
    id,
    name: 'Message ' + id,
    content: 'Content ' + id,
    createdAt: new Date().toISOString(),
    readAt: null,
    templateName: 'App',
    status: 'success',
  }));
  const f = fixture(t, async (route, method, body) => {
    if (route.endsWith('/inbox/unread')) return { count: 2 };
    if (route.includes('/inbox?')) return { items: messages, total: 2 };
    if (route.endsWith('/inbox/read')) {
      readIds.push(body.ids);
      if (readIds.length === 1)
        return new Promise((resolve) => {
          release = () => resolve({ success: true });
        });
      return { success: true };
    }
    return [];
  });
  await f.open(NotificationInbox, { active: true });
  await act(async () => {
    button('应用内消息，2 条未读').click();
    await tick();
  });
  await act(() => button('Message a').click());
  await act(() => button('返回消息').click());
  await act(() => button('Message b').click());
  await act(() => button('返回消息').click());
  await act(() => button('Message b').click());
  assert.match(document.querySelector('.history-run-output').textContent, /Content b/);
  await act(async () => {
    release();
    await tick();
  });
  assert.deepEqual(readIds, [['a'], ['b']]);
});

test('a failed pending sort reloads server order after returning and reports the failure', async (t) => {
  let rejectSave;
  const notices = [];
  const api = async (route, method) => {
    if (route.endsWith('/template-order'))
      return method === 'PUT'
        ? new Promise((_, reject) => {
            rejectSave = reject;
          })
        : { keys: [] };
    return [];
  };
  const f = fixture(t, api),
    props = { toast: (m) => notices.push(m) };
  await f.open(NotificationSettingsPage, props);
  await act(() => button('全部模板').click());
  const initial = sortedIds();
  await finishSort(initial[0], initial[3]);
  await f.open(NotificationSettingsPage, { ...props, active: false });
  await f.open(NotificationSettingsPage, { ...props, active: true });
  await act(() => button('全部模板').click());
  await act(async () => {
    rejectSave(Error('排序保存失败'));
    await tick();
  });
  assert.deepEqual(sortedIds(), initial);
  assert.ok(notices.includes('排序保存失败'));
});

test('a failed mark-read request does not discard the next opened message', async (t) => {
  let rejectFirst;
  const calls = [],
    notices = [];
  const items = ['a', 'b'].map((id) => ({
    id,
    name: 'Read ' + id,
    content: id,
    createdAt: new Date().toISOString(),
    readAt: null,
    templateName: 'App',
    status: 'success',
  }));
  const f = fixture(t, async (route, method, body) => {
    if (route.endsWith('/inbox/unread')) return { count: 2 };
    if (route.includes('/inbox?')) return { items, total: 2 };
    if (route.endsWith('/inbox/read')) {
      calls.push(body.ids);
      return calls.length === 1
        ? new Promise((_, reject) => {
            rejectFirst = reject;
          })
        : { success: true };
    }
    return [];
  });
  await f.open(NotificationInbox, { active: true, toast: (m) => notices.push(m) });
  await act(async () => {
    button('应用内消息，2 条未读').click();
    await tick();
  });
  await act(() => button('Read a').click());
  await act(() => button('返回消息').click());
  await act(() => button('Read b').click());
  await act(async () => {
    rejectFirst(Error('读取失败'));
    await tick();
  });
  assert.deepEqual(calls, [['a'], ['b']]);
  assert.ok(notices.includes('读取失败'));
});
