import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderStorageComponent } from './helpers/react-storage-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const built = await build({
  stdin: {
    contents:
      "export {ConfirmationHost} from './web/confirmation.tsx';export {TerminalAi} from './web/terminal-ai.tsx'; export {AiSettings} from './web/terminal-ai-settings.tsx'; export {AiHistory} from './web/terminal-ai-history.tsx'; export {StorageAttachments} from './web/storage-attachments.tsx';export {AiSkills} from './web/terminal-ai-skills.tsx'; export {AiAttachmentImage} from './web/ai-attachment-image.tsx'; export {StorageRename} from './web/storage-rename.tsx';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'select-render-boundary',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve(
          { filter: /^@douyinfe\/semi-ui\/lib\/es\/(?:tooltip|configProvider)$/ },
          () => ({
            path: 'tooltip',
            namespace: 'tooltip-boundary',
          }),
        );
        b.onLoad({ filter: /.*/, namespace: 'tooltip-boundary' }, () => ({
          loader: 'js',
          contents: 'export default function Tooltip(p){return p.children;}',
        }));
        b.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({
          path: 'select',
          namespace: 'boundary',
        }));
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({
          loader: 'js',
          contents:
            "import React from 'react'; export default function Select(p){return React.createElement('div',null,p.renderOptionItem ? p.optionList.map(o=>React.createElement(React.Fragment,{key:o.value},p.renderOptionItem({...o,onClick:()=>p.onChange(o.value)}))) : null);}",
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
const {
  TerminalAi,
  ConfirmationHost,
  AiSettings,
  AiHistory,
  StorageAttachments,
  AiSkills,
  AiAttachmentImage,
  StorageRename,
} = compiled.exports;
function mountTerminalAi(options) {
  const root = createRoot(document.querySelector('#ai-root'));
  let target = null,
    open = false;
  const render = () =>
    flushSync(() =>
      root.render(
        React.createElement(TerminalAi, {
          ...options,
          target,
          open,
          onClose: () => {
            open = false;
            render();
          },
        }),
      ),
    );
  const button = document.querySelector('#terminal-ai-toggle');
  button.onclick = () => {
    open = !open;
    render();
  };
  render();
  return {
    select(value) {
      target = value;
      render();
    },
    dispose() {
      flushSync(() => root.unmount());
      button.onclick = null;
    },
  };
}
function dialogFixture(Component, options) {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  let open = false,
    disposed = false;
  const render = () =>
    flushSync(() =>
      root.render(
        open
          ? React.createElement(Component, {
              ...options,
              canRestore:
                typeof options.canRestore === 'function'
                  ? options.canRestore()
                  : options.canRestore,
              onClose: () => {
                open = false;
                render();
              },
            })
          : null,
      ),
    );
  return {
    async open() {
      if (disposed) return;
      open = true;
      render();
      await tick();
      await tick();
    },
    close() {
      open = false;
      render();
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true;
      flushSync(() => root.unmount());
      host.remove();
    },
  };
}
const mountAiSettings = (options) => dialogFixture(AiSettings, options),
  mountAiSkills = (options) => dialogFixture(AiSkills, options),
  mountAiHistory = (options) => dialogFixture(AiHistory, options);
function attachmentsFixture(options) {
  let revision = 0;
  const view = renderStorageComponent(StorageAttachments, options, { active: false, revision });
  return {
    ...view,
    open: () => view.update({ active: true }),
    close: () => view.update({ active: false }),
    refresh: async () => {
      view.update({ revision: ++revision });
      await new Promise((r) => setTimeout(r, 180));
    },
    manage: () =>
      [...options.host.querySelectorAll('button')]
        .find((b) => b.textContent === '批量管理')
        .click(),
    selectionCount: () =>
      options.host.querySelectorAll(
        'input[type=checkbox]:checked:not([aria-label*="本页"]):not([aria-label*="全部"])',
      ).length,
  };
}
function renameFixture(options) {
  const view = renderStorageComponent(StorageRename, options, {
    active: true,
    path: '',
    onPath: (path) => view.update({ path }),
  });
  view.update();
  return { ...view, setPath: (path) => view.update({ path }) };
}
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function environment(t) {
  const dom = new JSDOM(
    '<main><button id="terminal-ai-toggle"></button><div id="ai-root"></div><aside id="terminal-assets"></aside></main>',
    { pretendToBeVisual: true },
  );
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  dom.window.HTMLDialogElement.prototype.close = function (value) {
    this.returnValue = value || '';
    this.removeAttribute('open');
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const originalClick = dom.window.HTMLElement.prototype.click;
  dom.window.HTMLElement.prototype.click = function () {
    flushSync(() => originalClick.call(this));
  };
  const confirmationHost = document.body.appendChild(document.createElement('div')),
    confirmationRoot = createRoot(confirmationHost);
  flushSync(() => confirmationRoot.render(React.createElement(ConfirmationHost)));
  const cleanups = [() => flushSync(() => confirmationRoot.unmount())];
  dom.cleanup = (fn) => cleanups.push(fn);
  t.after(() => {
    for (const fn of cleanups.reverse()) fn();
    Object.assign(globalThis, old);
    dom.window.close();
  });
  return dom;
}
function send(text) {
  const input = document.querySelector('textarea');
  const props = input[Object.keys(input).find((k) => k.startsWith('__reactProps'))];
  flushSync(() => props.onChange({ target: { value: text } }));
  document
    .querySelector('.terminal-ai-composer')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
for (const inFlight of [false, true])
  test(`AI session barriers order ${inFlight ? 'in-flight message then cancel' : 'idle cancel'} before returning-session messages`, async (t) => {
    const dom = environment(t);
    const messages = [],
      cancels = [],
      events = [],
      first = deferred(),
      cancel = deferred();
    const ui = mountTerminalAi({
      element: document.querySelector('main'),
      toast: () => {},
      api: async (path, method, data) => {
        const id = path.split('/')[3];
        if (path.endsWith('/messages')) {
          messages.push([id, data.text]);
          events.push('message:' + data.text);
          if (data.text === 'first') await first.promise;
          return {};
        }
        if (path.endsWith('/cancel')) {
          cancels.push(id);
          events.push('cancel:' + id);
          if (id === 'a') await cancel.promise;
          return {};
        }
        throw Error(path);
      },
    });
    dom.cleanup(() => {
      ui.dispose();
      first.resolve();
      cancel.resolve();
    });
    ui.select({ id: 'a', generation: 1, connected: true });
    if (inFlight) {
      send('first');
      await tick();
    }
    ui.select({ id: 'b', generation: 1, connected: true });
    send('other session');
    await tick();
    assert.deepEqual(messages.at(-1), ['b', 'other session']);
    ui.select({ id: 'a', generation: 1, connected: true });
    await tick();
    if (inFlight)
      assert.equal(cancels.includes('a'), false, 'cancel must wait for accepted message');
    send('too early');
    await tick();
    assert.equal(
      messages.some(([, text]) => text === 'too early'),
      false,
      'returning session must wait for old cancellation',
    );
    first.resolve();
    await tick();
    await tick();
    assert.equal(cancels.includes('a'), true);
    cancel.resolve();
    await tick();
    await tick();
    send('new');
    await tick();
    assert.equal(messages.at(-1)[1], 'new');
    assert.ok(events.indexOf('cancel:a') < events.indexOf('message:new'));
  });
for (const mutation of ['save', 'delete'])
  test(`AI ${mutation} success after settings close still synchronizes live workspace`, async (t) => {
    const dom = environment(t);
    const pending = deferred();
    let synchronized = 0,
      mutated = false;
    const settings = mountAiSettings({
      toast: () => {},
      onSave: () => synchronized++,
      api: async (path, method) => {
        if (method === 'PUT' || method === 'DELETE') {
          await pending.promise;
          mutated = true;
          return {};
        }
        if (path.endsWith('/test')) return { models: ['m'] };
        return [
          {
            id: 'p',
            name: 'p',
            protocol: 'openai',
            baseUrl: 'https://example.test/v1',
            model: 'm',
            apiKey: '',
          },
        ];
      },
    });
    dom.cleanup(() => {
      settings.dispose();
      pending.resolve();
    });
    await settings.open();
    if (mutation === 'save')
      document
        .querySelector('dialog form')
        .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    else {
      document.querySelector('[aria-label="删除供应商 p"]').click();
      document.querySelector('dialog.confirmation-dialog [data-accept]').click();
      await tick();
    }
    settings.close();
    await settings.open();
    const reopened = document.querySelector('dialog:not(.confirmation-dialog)');
    pending.resolve();
    await tick();
    await tick();
    assert.equal(mutated, true);
    assert.equal(synchronized, 1);
    assert.equal(reopened.open, true, 'completion must not close a newer dialog');
  });
test('AI history readiness updates busy entries without reopening', async (t) => {
  const dom = environment(t);
  let ready = false;
  const history = mountAiHistory({
    api: async () => [{ id: 'x', title: 'x', connectionName: 'NAS', updatedAt: 1 }],
    toast: () => {},
    canRestore: () => ready,
    onRestore: async () => {},
  });
  dom.cleanup(() => history.dispose());
  await history.open();
  assert.equal(document.querySelector('.terminal-ai-history-entry').disabled, true);
  ready = true;
  history.refresh?.();
  assert.equal(document.querySelector('.terminal-ai-history-entry').disabled, false);
});

test('AI polling refreshes an open history dialog when generation finishes', async (t) => {
  const dom = environment(t);
  let busy = true,
    poll;
  const originalInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, delay) => {
    if (delay === 750) poll = callback;
    return originalInterval(() => {}, 60000);
  };
  dom.cleanup(() => {
    globalThis.setInterval = originalInterval;
  });
  const ui = mountTerminalAi({
    element: document.querySelector('main'),
    toast: () => {},
    api: async (path) => {
      if (path.endsWith('/conversation'))
        return {
          chatId: 'x',
          revision: busy ? 1 : 2,
          busy,
          messages: [],
          proposals: [],
          error: null,
        };
      if (path.endsWith('/history'))
        return [{ id: 'x', title: 'x', connectionName: 'NAS', updatedAt: 1 }];
      if (path.endsWith('/providers')) return [{ id: 'p', name: 'p', model: 'm' }];
      if (path.endsWith('/models')) return ['m'];
      return {};
    },
  });
  dom.cleanup(() => ui.dispose());
  ui.select({ id: 'a', generation: 1, connected: true });
  document.querySelector('#terminal-ai-toggle').click();
  await tick();
  await tick();
  document.querySelector('[aria-label="AI 历史记录"]').click();
  await tick();
  assert.equal(document.querySelector('.terminal-ai-history-entry').disabled, true);
  busy = false;
  await poll();
  await tick();
  await tick();
  assert.equal(document.querySelector('.terminal-ai-history-entry').disabled, false);
});

for (const operation of ['message', 'execute', 'new'])
  for (const leave of ['select', 'dispose'])
    test(`AI queued ${operation} does not dispatch after same-tick ${leave}`, async (t) => {
      const dom = environment(t),
        mutations = [];
      let disposed = false;
      const ui = mountTerminalAi({
        element: document.querySelector('main'),
        toast: () => {},
        api: async (path, method) => {
          if (method === 'POST') {
            mutations.push(path);
            return {};
          }
          if (path.endsWith('/conversation'))
            return {
              chatId: 'x',
              revision: 1,
              busy: false,
              error: null,
              messages: [{ id: 'm', role: 'assistant', content: 'command' }],
              proposals: [
                {
                  id: 'call',
                  proposalId: 'p',
                  messageId: 'm',
                  command: 'pwd',
                  explanation: 'inspect',
                  status: 'pending',
                },
              ],
            };
          if (path.endsWith('/providers')) return [{ id: 'p', name: 'p', model: 'm' }];
          if (path.endsWith('/models')) return ['m'];
          return [];
        },
      });
      dom.cleanup(() => {
        if (!disposed) ui.dispose();
      });
      ui.select({ id: 'a', generation: 1, connected: true });
      if (operation !== 'message') {
        document.querySelector('#terminal-ai-toggle').click();
        await tick();
        await tick();
      }
      if (operation === 'message') send('obsolete');
      else if (operation === 'execute')
        document.querySelector('button[data-ai-proposal-action].primary').click();
      else document.querySelector('[aria-label="新建 AI 会话"]').click();
      if (leave === 'select') ui.select({ id: 'b', generation: 1, connected: true });
      else {
        ui.dispose();
        disposed = true;
      }
      await tick();
      await tick();
      assert.equal(
        mutations.some((path) => !path.endsWith('/cancel')),
        false,
      );
      assert.equal(
        mutations.includes('/terminal/sessions/a/ai/cancel'),
        true,
        'cleanup cancellation must still dispatch',
      );
    });

test('AI thinking occupies the next reply in the message flow and disappears when the reply arrives', async (t) => {
  const dom = environment(t);
  let busy = true,
    poll;
  const originalInterval = globalThis.setInterval;
  globalThis.setInterval = (callback, delay) => {
    if (delay === 750) poll = callback;
    return originalInterval(() => {}, 60000);
  };
  dom.cleanup(() => {
    globalThis.setInterval = originalInterval;
  });
  const ui = mountTerminalAi({
    element: document.querySelector('main'),
    toast: () => {},
    api: async (path) => {
      if (path.endsWith('/conversation'))
        return {
          chatId: 'chat',
          revision: busy ? 1 : 2,
          busy,
          messages: [
            { id: 'user', role: 'user', content: '检查系统' },
            { id: 'empty-assistant', role: 'assistant', content: '' },
            ...(!busy ? [{ id: 'reply', role: 'assistant', content: '检查完成' }] : []),
          ],
          proposals: [],
          error: null,
        };
      if (path.endsWith('/providers')) return [{ id: 'p', name: 'p', model: 'm' }];
      if (path.endsWith('/models')) return ['m'];
      return {};
    },
  });
  dom.cleanup(() => ui.dispose());
  ui.select({ id: 'a', generation: 1, connected: true });
  document.querySelector('#terminal-ai-toggle').click();
  await tick();
  await tick();
  const waiting = document.querySelector('.inline-loading');
  assert.ok(waiting?.closest('.terminal-ai-messages'), 'thinking belongs to the scrollable chat');
  assert.ok(waiting.closest('.terminal-ai-message.assistant'));
  assert.match(waiting.textContent, /正在思考/);
  const chat = document.querySelector('.terminal-ai-messages');
  assert.equal(chat.lastElementChild.contains(waiting), true);
  assert.equal(
    chat.querySelectorAll('.terminal-ai-message.assistant').length,
    1,
    'no empty AI heading before the thinking placeholder',
  );
  assert.match(chat.firstElementChild.textContent, /检查系统/);
  busy = false;
  await poll();
  await tick();
  await tick();
  assert.equal(chat.querySelector('.inline-loading'), null);
  assert.match(chat.lastElementChild.textContent, /检查完成/);
  await tick();
});

function reactProps(element) {
  return element[Object.keys(element).find((key) => key.startsWith('__reactProps'))];
}
test('AI attachments support picker, removal, paste, drop and attachment-only submission; failed sends retain drafts', async (t) => {
  const env = environment(t),
    sent = [],
    errors = [];
  let fail = true;
  const ui = mountTerminalAi({
    element: document.querySelector('main'),
    toast: (x) => errors.push(x),
    api: async (path, method, data) => {
      if (path.endsWith('/messages')) {
        sent.push(data);
        if (fail) throw Error('fixture failure');
        return { accepted: true };
      }
      if (path.endsWith('/cancel')) return {};
      throw Error(path);
    },
  });
  env.cleanup(() => ui.dispose());
  ui.select({ id: 'a', generation: 1, connected: true });
  const file = {
    name: 'debug.log',
    type: 'text/plain',
    size: 4,
    arrayBuffer: async () => new TextEncoder().encode('test').buffer,
  };
  reactProps(document.querySelector('input[type=file]')).onChange({
    target: { files: [file], value: 'file' },
  });
  await tick();
  assert.equal(document.querySelector('.terminal-assets-header strong').textContent, 'AI');
  assert.ok(document.querySelector('[aria-label="待发送附件"]').textContent.includes('debug.log'));
  document.querySelector('[aria-label="移除附件 debug.log"]').click();
  assert.equal(document.querySelector('[aria-label="待发送附件"]'), null);
  let prevented = 0;
  reactProps(document.querySelector('form')).onDrop({
    dataTransfer: { files: [file] },
    preventDefault: () => prevented++,
  });
  await tick();
  send('');
  await tick();
  await tick();
  assert.equal(sent[0].text, '');
  assert.deepEqual(Object.keys(sent[0].attachments[0]).sort(), [
    'data',
    'kind',
    'mimeType',
    'name',
  ]);
  assert.ok(document.querySelector('[aria-label="待发送附件"]'), 'failure retains draft');
  fail = false;
  send('');
  await tick();
  await tick();
  assert.equal(document.querySelector('[aria-label="待发送附件"]'), null);
  const image = {
    name: 'paste.png',
    type: 'image/png',
    size: 3,
    arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer,
  };
  reactProps(document.querySelector('form')).onPaste({
    clipboardData: { files: [image] },
    preventDefault: () => prevented++,
  });
  await tick();
  assert.ok(document.querySelector('[aria-label="待发送附件"]').textContent.includes('paste.png'));
  const thumb = document.querySelector('[aria-label="待发送附件"] img');
  assert.ok(thumb, 'image drafts show a thumbnail');
  assert.equal(thumb.getAttribute('src'), 'data:image/png;base64,AQID');
  document.querySelector('[aria-label="预览图片 paste.png"]').click();
  await tick();
  assert.ok(document.querySelector('dialog.terminal-ai-image-preview img'));
  document.querySelector('dialog.terminal-ai-image-preview .dialog-close').click();
  await tick();
  assert.equal(document.querySelector('dialog.terminal-ai-image-preview'), null);
  assert.equal(prevented, 2);
  ui.select({ id: 'b', generation: 1, connected: true });
  assert.equal(document.querySelector('[aria-label="待发送附件"]'), null);
  assert.ok(errors.includes('fixture failure'));
  await tick();
});
test('late file reads cannot attach to a different SSH selection', async (t) => {
  const env = environment(t),
    read = deferred();
  const ui = mountTerminalAi({
    element: document.querySelector('main'),
    toast: () => {},
    api: async () => ({}),
  });
  env.cleanup(() => ui.dispose());
  ui.select({ id: 'a', generation: 1, connected: true });
  reactProps(document.querySelector('input[type=file]')).onChange({
    target: {
      files: [{ name: 'test.txt', size: 4, type: 'text/plain', arrayBuffer: () => read.promise }],
      value: '',
    },
  });
  ui.select({ id: 'b', generation: 1, connected: true });
  read.resolve(new TextEncoder().encode('test').buffer);
  await tick();
  await tick();
  assert.equal(document.querySelector('[aria-label="待发送附件"]'), null);
});

test('storage attachment manager filters and confirms selected cleanup using shared dialogs', async (t) => {
  const env = environment(t),
    deleted = [],
    reads = [];
  let hasFile = true,
    changed = 0;
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast: () => {},
    onChanged: () => {
      changed++;
    },
    api: async (path, method, data) => {
      if (path.startsWith('/storage/attachments?')) {
        reads.push(path);
        return {
          items: hasFile
            ? [
                {
                  id: 'file',
                  name: 'debug.log',
                  kind: 'text',
                  mimeType: 'text/plain',
                  size: 100,
                  chatId: 'chat',
                  chatTitle: 'Test chat',
                  createdAt: 1,
                },
              ]
            : [],
          page: 1,
          pageSize: 20,
          total: hasFile ? 1 : 0,
          summary: { count: hasFile ? 1 : 0, bytes: hasFile ? 100 : 0 },
        };
      }
      if (path === '/storage/attachments/delete') {
        deleted.push(data);
        hasFile = false;
        return { count: 1, bytes: 100, cleanupPending: false };
      }
      throw Error(path);
    },
  });
  env.cleanup(() => manager.dispose());
  manager.open();
  await tick();
  assert.ok(document.querySelector('[aria-label="应用附件分页"]'));
  assert.equal(
    [...document.querySelectorAll('button')].some((b) => b.textContent === '清理无引用附件'),
    false,
  );
  await new Promise((r) => setTimeout(r, 220));
  await tick();
  assert.ok(document.querySelector('[aria-label="应用附件"]').textContent.includes('debug.log'));
  assert.equal(document.querySelector('dialog[aria-label="应用附件"]'), null);
  assert.ok(document.querySelector('.storage-history-table:not(.dialog-table)'));
  document.querySelector('[aria-label="选择附件 debug.log"]').click();
  await tick();
  void manager.manage();
  await tick();
  assert.equal(deleted.length, 0, 'cleanup waits for confirmation');
  const confirmation = document.querySelector('dialog.confirmation-dialog');
  [...confirmation.querySelectorAll('button')].find((b) => b.textContent === '清理').click();
  await tick();
  await tick();
  await tick();
  assert.deepEqual(deleted, [{ ids: ['file'], confirmed: true }]);
  assert.equal(changed, 1);
  assert.ok(reads.length >= 2);
  assert.equal(
    document.querySelector('[aria-label="应用附件"]').textContent.includes('debug.log'),
    false,
  );
  await tick();
});

test('skills editor manages definitions without manual package import and saves only explicitly enabled definitions', async (t) => {
  const env = environment(t),
    writes = [];
  const ui = mountAiSkills({
    toast: () => {},
    api: async (path, method, data) => {
      if (path === '/terminal/ai/skills' && method === 'POST') {
        writes.push(data);
        return { id: 'saved', name: 'test-skill', description: 'test', ...data };
      }
      if (path === '/terminal/ai/skills') return [];
      throw Error(path);
    },
  });
  env.cleanup(() => ui.dispose());
  await ui.open();
  const content = '---\nname: test-skill\ndescription: test\n---\nCheck pwd.';
  assert.equal(document.querySelector('[aria-label="导入 SKILL.md"]'), null);
  assert.equal(
    [...document.querySelectorAll('button')].some((b) => b.textContent === '下载技能包'),
    false,
  );
  reactProps(document.querySelector('textarea')).onChange({ target: { value: content } });
  await tick();
  assert.equal(document.querySelector('textarea').value, content);
  const enable = document.querySelector('input[type=checkbox]');
  assert.equal(enable.checked, false);
  enable.click();
  await tick();
  document
    .querySelector('dialog:not(.confirmation-dialog) form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  assert.deepEqual(writes, [{ document: content, enabled: true }]);
});
test('failed skill detail loads cannot overwrite a different definition with a stale draft', async (t) => {
  const env = environment(t),
    writes = [];
  const ui = mountAiSkills({
    toast: () => {},
    api: async (path, method) => {
      if (method) {
        writes.push(path);
        return {};
      }
      if (path === '/terminal/ai/skills')
        return [{ id: 'b', name: 'skill-b', description: 'b', enabled: false }];
      throw Error('detail unavailable');
    },
  });
  env.cleanup(() => ui.dispose());
  await ui.open();
  const save = document.querySelector('dialog:not(.confirmation-dialog) button[type=submit]');
  assert.equal(save.disabled, true);
  document
    .querySelector('form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.deepEqual(writes, []);
  assert.match(document.querySelector('[role=alert]').textContent, /detail unavailable/);
});

test('saved image previews ignore late responses after selection changes and disappear after cleanup', async (t) => {
  const env = environment(t);
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const root = createRoot(document.querySelector('main'));
  const first = deferred();
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    return path.includes('/first/') ? first.promise : { mimeType: 'image/png', data: 'Ag==' };
  };
  const attachment = {
    id: 'first',
    name: 'first.png',
    kind: 'image',
    mimeType: 'image/png',
    size: 1,
  };
  const render = (value) =>
    flushSync(() =>
      root.render(React.createElement(AiAttachmentImage, { attachment: value, api })),
    );
  env.cleanup(() => root.unmount());
  render(attachment);
  await tick();
  render({ ...attachment, id: 'second', name: 'second.png' });
  await tick();
  await tick();
  first.resolve({ mimeType: 'image/png', data: 'AQ==' });
  await tick();
  await tick();
  assert.equal(document.querySelector('img').getAttribute('src'), 'data:image/png;base64,Ag==');
  assert.equal(document.querySelector('img').alt, 'second.png');
  render({ ...attachment, id: 'second', name: 'second.png', removed: true });
  await tick();
  assert.equal(document.querySelector('img'), null);
  assert.equal(calls.length, 2);
});

test('mobile attachment cards select as a whole and keep in-use files unavailable', async (t) => {
  const env = environment(t);
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast: () => {},
    onChanged: () => {},
    api: async () => ({
      items: [
        {
          id: 'free',
          name: 'free.png',
          kind: 'image',
          size: 1024,
          chatId: 'chat',
          chatTitle: 'Preview',
          createdAt: 1,
        },
        {
          id: 'busy',
          name: 'busy.log',
          kind: 'text',
          size: 12,
          chatId: 'other',
          chatTitle: 'Running',
          createdAt: 1,
          inUse: true,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      summary: { count: 2, bytes: 1036 },
    }),
  });
  env.cleanup(() => manager.dispose());
  manager.open();
  await new Promise((r) => setTimeout(r, 220));
  await tick();
  const card = document.querySelector('button[aria-label="选择记录 free.png"]');
  assert.ok(card, 'mobile files expose a full-card selection action');
  card.click();
  await tick();
  assert.equal(document.querySelector('[aria-label="选择 free.png"]').checked, true);
  assert.equal(
    document.querySelector('[aria-label="选择记录 free.png"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(document.querySelector('[aria-label="选择记录 busy.log"]').disabled, true);
  assert.equal(manager.selectionCount(), 1);
});

test('skills dialog shows loading without exposing editable template before catalog and detail settle', async (t) => {
  const env = environment(t),
    catalog = deferred(),
    detail = deferred();
  let reads = 0;
  const ui = mountAiSkills({
    toast: () => {},
    api: async (path) => {
      if (path === '/terminal/ai/skills') {
        reads++;
        return catalog.promise;
      }
      return detail.promise;
    },
  });
  env.cleanup(() => ui.dispose());
  const pending = ui.open();
  await tick();
  const dialog = document.querySelector('dialog:not(.confirmation-dialog)');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('textarea').disabled, true);
  await ui.open();
  assert.equal(reads, 1);
  catalog.resolve([{ id: 'skill', name: 'example', description: 'test', enabled: true }]);
  await tick();
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('textarea').disabled, true);
  detail.resolve({
    id: 'skill',
    kind: 'package',
    name: 'example',
    document: 'Loaded package content',
    enabled: true,
  });
  await pending;
  await tick();
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('textarea').value, 'Loaded package content');
  assert.equal(dialog.querySelector('[role="status"]'), null);
});

test('disposing skills while opening prevents a late catalog from displaying a dialog', async (t) => {
  const env = environment(t),
    catalog = deferred();
  const ui = mountAiSkills({ toast: () => {}, api: async () => catalog.promise });
  const pending = ui.open();
  await tick();
  ui.dispose();
  catalog.resolve([]);
  await pending;
  await tick();
  assert.equal(document.querySelector('dialog:not(.confirmation-dialog)'), null);
  env.cleanup(() => {});
});

test('mobile attachment refresh restarts at page one after loading more and stays idle after close', async (t) => {
  const env = environment(t);
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const reads = [];
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast() {},
    onChanged() {},
    api: async (path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      reads.push(page);
      return {
        items: [
          {
            id: 'file-' + page,
            name: 'file-' + page + '.txt',
            kind: 'text',
            size: 1,
            chatTitle: 'Chat',
            createdAt: 1,
          },
        ],
        total: 3,
        page,
        pageSize: 1,
        summary: { count: 3, bytes: 3 },
      };
    },
  });
  env.cleanup(() => manager.dispose());
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 220));
    await tick();
  };
  manager.open();
  await settle();
  [...document.querySelectorAll('button')].find((b) => b.textContent === '加载更多').click();
  await settle();
  assert.deepEqual(reads, [1, 2]);
  await manager.refresh();
  await settle();
  assert.deepEqual(reads, [1, 2, 1]);
  assert.ok(document.querySelector('[aria-label="选择记录 file-1.txt"]'));
  assert.equal(document.querySelector('[aria-label="选择记录 file-2.txt"]'), null);
  manager.close();
  await manager.refresh();
  await settle();
  assert.deepEqual(reads, [1, 2, 1]);
});

test('mobile attachment load-more retries the failed page instead of skipping it', async (t) => {
  const env = environment(t);
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const reads = [];
  let failed = false;
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast() {},
    onChanged() {},
    api: async (path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      reads.push(page);
      if (page === 2 && !failed) {
        failed = true;
        throw Error('temporary failure');
      }
      return {
        items: [
          {
            id: 'file-' + page,
            name: 'file-' + page + '.txt',
            kind: 'text',
            size: 1,
            chatTitle: 'Chat',
            createdAt: 1,
          },
        ],
        total: 3,
        page,
        pageSize: 1,
        summary: { count: 3, bytes: 3 },
      };
    },
  });
  env.cleanup(() => manager.dispose());
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 220));
    await tick();
  };
  const load = () =>
    [...document.querySelectorAll('button')]
      .find((b) => /加载更多|重试/.test(b.textContent))
      .click();
  manager.open();
  await settle();
  load();
  await settle();
  assert.match(document.body.textContent, /temporary failure/);
  load();
  await settle();
  assert.deepEqual(reads, [1, 2, 2]);
  assert.ok(document.querySelector('[aria-label="选择记录 file-1.txt"]'));
  assert.ok(document.querySelector('[aria-label="选择记录 file-2.txt"]'));
  load();
  await settle();
  assert.deepEqual(reads, [1, 2, 2, 3]);
});

test('AI settings load credentials only for editing and refuse saving after detail failure', async (t) => {
  const env = environment(t),
    calls = [];
  const provider = {
    id: 'p',
    name: 'p',
    protocol: 'openai',
    baseUrl: 'https://example.test/v1',
    model: 'm',
  };
  let fail = true;
  const settings = mountAiSettings({
    toast() {},
    api: async (path, method) => {
      calls.push([path, method]);
      if (path === '/terminal/ai/providers') return [provider];
      if (path === '/terminal/ai/providers/p') {
        if (fail) throw Error('读取失败');
        return { ...provider, apiKey: 'secret' };
      }
      return { models: ['m'] };
    },
  });
  env.cleanup(() => settings.dispose());
  await settings.open();
  assert.equal(document.querySelector('button[type=submit]').disabled, true);
  document
    .querySelector('form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(
    calls.some(([, method]) => method === 'PUT'),
    false,
  );
  fail = false;
  [...document.querySelectorAll('button')].find((b) => b.textContent === '重试').click();
  await tick();
  await tick();
  assert.equal(document.querySelector('input[type=password]').value, 'secret');
  assert.equal(document.querySelector('button[type=submit]').disabled, false);
});

test('attachment initial failure shows retry instead of empty state and retries first page', async (t) => {
  const env = environment(t),
    reads = [];
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast() {},
    onChanged() {},
    api: async (path) => {
      reads.push(path);
      if (reads.length === 1) throw Error('附件暂不可用');
      return { items: [], page: 1, pageSize: 20, total: 0, summary: { count: 0, bytes: 0 } };
    },
  });
  env.cleanup(() => manager.dispose());
  manager.open();
  await new Promise((r) => setTimeout(r, 240));
  await tick();
  assert.match(document.body.textContent, /附件暂不可用/);
  assert.doesNotMatch(document.body.textContent, /暂无附件/);
  [...document.querySelectorAll('button')].find((b) => b.textContent === '重试').click();
  await tick();
  await tick();
  assert.match(document.body.textContent, /暂无附件/);
  assert.equal(reads[0], reads[1]);
});

test('mobile attachments can deselect a capped batch after accumulating over 200 files', async (t) => {
  const env = environment(t);
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast() {},
    onChanged() {},
    api: async (path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      const count = page === 21 ? 1 : 10;
      return {
        items: Array.from({ length: count }, (_, i) => ({
          id: String((page - 1) * 10 + i),
          name: 'file' + ((page - 1) * 10 + i),
          kind: 'text',
          mimeType: 'text/plain',
          size: 1,
          chatId: 'chat',
          chatTitle: 'chat',
          createdAt: 1,
        })),
        page,
        pageSize: 10,
        total: 201,
        summary: { count: 201, bytes: 201 },
      };
    },
  });
  env.cleanup(() => manager.dispose());
  manager.open();
  const waitForPage = async (count) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        document.querySelectorAll('.history-compact-row:not(.history-compact-select-all)')
          .length === count &&
        !document.querySelector('[aria-label="选择本页可清理记录"]').disabled
      )
        return;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail('attachment page did not finish loading');
  };
  await waitForPage(10);
  for (let i = 1; i < 21; i++) {
    [...document.querySelectorAll('button')].find((b) => b.textContent === '加载更多').click();
    await waitForPage(Math.min((i + 1) * 10, 201));
  }
  const all = document.querySelector('[aria-label="选择本页可清理记录"]');
  all.click();
  await tick();
  assert.equal(manager.selectionCount(), 200);
  assert.equal(all.checked, true);
  all.click();
  await tick();
  assert.equal(manager.selectionCount(), 0);
});

test('file organizer can choose a directory without first opening a scan result', async (t) => {
  const env = environment(t);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<button id="storage-batch"></button><header id="organizer-toolbar"></header><section id="organizer"></section><section id="rename-history"></section>',
  );
  const requests = [];
  const organizer = renameFixture({
    host: document.querySelector('#organizer'),
    toolbarHost: document.querySelector('#organizer-toolbar'),
    historyHost: document.querySelector('#rename-history'),
    toast: (message) => assert.fail(message),
    api: async (url) => {
      requests.push(url);
      return {
        items: [
          { name: 'example.txt', type: 'file', size: 10, modifiedAt: '2026-10-23T00:00:00Z' },
        ],
        truncated: false,
      };
    },
    onChoose: () => organizer.setPath('/documents'),
  });
  env.cleanup(() => organizer.dispose());
  assert.equal(requests.length, 0);
  const choose = document.querySelector('#organizer [aria-label="选择整理目录"]');
  assert.ok(choose, 'direct entry must provide a directory selection action');
  choose.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.ok(requests.includes('/storage/rename/files?path=%2Fdocuments'));
  assert.match(document.querySelector('#organizer').textContent, /example.txt/);
});

test('AI progress exposes elapsed steps and disables duplicate stop until cancellation acknowledgement', async (t) => {
  const env = environment(t),
    pendingCancel = deferred();
  let cancellations = 0,
    stopped = false;
  const startedAt = Date.now() - 2200;
  const ui = mountTerminalAi({
    element: document.querySelector('main'),
    toast: () => {},
    api: async (path) => {
      if (path.endsWith('/conversation'))
        return {
          chatId: 'progress-chat',
          revision: stopped ? 2 : 1,
          busy: !stopped,
          error: null,
          executionMode: 'review',
          messages: [],
          proposals: [],
          progress: {
            startedAt,
            ...(stopped ? { finishedAt: startedAt + 2300 } : {}),
            steps: [
              {
                phase: stopped ? 'cancelled' : 'thinking',
                label: stopped ? '已停止本轮响应' : '正在等待模型响应',
                startedAt,
                ...(stopped ? { finishedAt: startedAt + 2300 } : {}),
              },
            ],
          },
        };
      if (path.endsWith('/cancel')) {
        cancellations++;
        await pendingCancel.promise;
        stopped = true;
        return {};
      }
      if (path === '/terminal/ai/providers')
        return [
          { id: 'provider', name: 'Fixture', model: 'fixture', protocol: 'openai', hasKey: true },
        ];
      if (path.endsWith('/models')) return ['fixture'];
      throw Error(path);
    },
  });
  env.cleanup(() => {
    pendingCancel.resolve();
    ui.dispose();
  });
  ui.select({ id: 'a', generation: 1, connected: true });
  document.querySelector('#terminal-ai-toggle').click();
  await tick();
  await tick();
  assert.match(document.querySelector('.terminal-ai-progress').textContent, /已用时 2 秒/);
  assert.match(document.querySelector('.terminal-ai-progress li').textContent, /正在等待模型响应/);
  document.querySelector('[aria-label="停止 AI 操作"]').click();
  await tick();
  assert.equal(cancellations, 1);
  const stop = document.querySelector('[aria-label="正在停止 AI 操作"]');
  assert.ok(stop.disabled);
  stop.click();
  await tick();
  assert.equal(cancellations, 1);
  assert.match(document.querySelector('.terminal-ai-progress').textContent, /正在发送停止请求/);
  pendingCancel.resolve();
  await tick();
  await tick();
  await tick();
  assert.match(document.querySelector('.terminal-ai-progress').textContent, /已停止本轮响应/);
  assert.equal(document.querySelector('[aria-label="正在停止 AI 操作"]'), null);
  assert.ok(document.querySelector('[aria-label="发送消息"]'));
});

test('mobile attachment reopening starts from page one without duplicating loaded rows', async (t) => {
  const env = environment(t);
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const reads = [];
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast() {},
    onChanged() {},
    api: async (path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      reads.push(page);
      return {
        items: [
          {
            id: 'file-' + page,
            name: 'file-' + page + '.txt',
            kind: 'text',
            size: 1,
            chatTitle: 'Chat',
            createdAt: 1,
          },
        ],
        total: 3,
        page,
        pageSize: 1,
      };
    },
  });
  env.cleanup(() => manager.dispose());
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 220));
    await tick();
  };
  manager.open();
  await settle();
  [...document.querySelectorAll('button')].find((b) => b.textContent === '加载更多').click();
  await settle();
  manager.close();
  await settle();
  manager.open();
  await settle();
  assert.deepEqual(reads, [1, 2, 1]);
  assert.equal(document.querySelectorAll('[aria-label="选择记录 file-2.txt"]').length, 0);
  [...document.querySelectorAll('button')].find((b) => b.textContent === '加载更多').click();
  await settle();
  assert.equal(document.querySelectorAll('[aria-label="选择记录 file-2.txt"]').length, 1);
});

test('attachment cleanup completion while hidden unlocks controls on return', async (t) => {
  const env = environment(t),
    pending = deferred();
  const manager = attachmentsFixture({
    host: document.body.appendChild(document.createElement('section')),
    toast() {},
    onChanged() {},
    api: async (path) =>
      path.endsWith('/delete')
        ? pending.promise
        : {
            items: [
              {
                id: 'file',
                name: 'debug.log',
                kind: 'text',
                size: 1,
                chatTitle: 'Chat',
                createdAt: 1,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
          },
  });
  env.cleanup(() => manager.dispose());
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 220));
    await tick();
  };
  manager.open();
  await settle();
  document.querySelector('[aria-label="选择附件 debug.log"]').click();
  await tick();
  void manager.manage();
  await tick();
  document.querySelector('[data-accept]').click();
  await tick();
  manager.close();
  await tick();
  pending.resolve({ count: 1, bytes: 1 });
  await tick();
  await tick();
  manager.open();
  await settle();
  assert.equal(document.querySelector('[aria-label="选择附件 debug.log"]').disabled, false);
  assert.equal(document.querySelector('[aria-label="搜索附件名称或会话"]').disabled, false);
});
