import { RemoteDialogHost } from '../.web-test/features/terminal/dialogs.js';
import { Simulate } from 'react-dom/test-utils';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { FileListing } from '../.web-test/terminal-file-listing.js';
import { useFilePanelResize } from '../.web-test/terminal-file-resize.js';
import { useFileInteractions } from '../.web-test/terminal-file-interactions.js';
import { createFileUploadHandlers } from '../.web-test/terminal-file-uploads.js';
import { createFileOperations } from '../.web-test/terminal-file-operations.js';
import { askName } from '../.web-test/terminal-file-name-dialog.js';
import { isCurrentResponse } from '../.web-test/terminal-file-model.js';

const h = React.createElement;
const ref = (current) => ({ current });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

function setupDom(t) {
  const dom = new JSDOM('<main><div id="files"></div></main>'),
    globals = {
      CustomEvent: dom.window.CustomEvent,
      window: dom.window,
      document: dom.window.document,
      Event: dom.window.Event,
      matchMedia: () => ({ matches: false }),
      IS_REACT_ACT_ENVIRONMENT: true,
    },
    previous = {};
  for (const [key, value] of Object.entries(globals)) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  dom.window.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value;
    this.removeAttribute('open');
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const dialogHost = dom.window.document.createElement('div');
  dom.window.document.body.append(dialogHost);
  dom.dialogRoot = createRoot(dialogHost);
  act(() => dom.dialogRoot.render(h(RemoteDialogHost)));
  t.after(async () => {
    await act(() => dom.dialogRoot.unmount());
    if (dom.root) await act(() => dom.root.unmount());
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  });
  return dom;
}

function operationsFixture(overrides = {}) {
  const session = { id: 'one', generation: 2, connected: true },
    state = { busy: false, error: '', progress: null, status: '' },
    calls = [],
    context = { session: { ...session }, path: '/home', sequence: 3 },
    options = {
      busy: false,
      session,
      current: ref(session),
      directory: ref('/home'),
      seq: ref(3),
      pendingUpload: ref(context),
      upload: ref(null),
      taskEpoch: ref(0),
      data: { path: '/home', entries: [] },
      calculating: null,
      setBusy: (value) => (state.busy = value),
      setError: (value) => (state.error = value),
      setProgress: (value) => (state.progress = value),
      setOperationStatus: (value) => (state.status = value),
      setCalculating: (value) => calls.push(['calculating', value]),
      setSizes: () => {},
      confirm: async () => true,
      toast: (message) => calls.push(['toast', message]),
      load: async (...args) => calls.push(['load', ...args]),
      fileApi: {
        action: async (...args) => calls.push(['action', ...args]),
        upload: async (...args) => calls.push(['upload', ...args]),
      },
      ...overrides,
    };
  options.valid = (snapshot) => isCurrentResponse(snapshot, options.current.current);
  return { options, state, calls, context };
}

function selection(files) {
  return { target: { files, value: 'chosen' } };
}

test('extracted listing preserves mouse, touch, keyboard and long-press activation', async (t) => {
  const dom = setupDom(t),
    document = dom.window.document,
    root = (dom.root = createRoot(document.querySelector('#files'))),
    opened = [],
    sorted = [],
    context = [],
    props = {
      data: {
        path: '/home',
        entries: [
          { name: 'notes.txt', type: 'file', size: 12, mtime: 0 },
          { name: '目录', type: 'directory', mtime: 0 },
        ],
      },
      sizes: {},
      sort: { key: 'name', desc: false },
      setSort: (value) => sorted.push(value),
      calculating: null,
      context: null,
      showContext: (event, entry) => {
        event.stopPropagation();
        context.push(entry?.name);
      },
      touchStart: () => {},
      longPress: ref(false),
      lastPointer: ref('mouse'),
      load: (path) => opened.push(path),
      session: { connected: true },
      calculate: () => {},
      loading: false,
      clearPress: () => {},
      press: ref(null),
      setContext: () => {},
    };
  await act(() => root.render(h(FileListing, props)));
  const rows = [...document.querySelectorAll('tbody tr')],
    directory = rows[0],
    name = directory.querySelector('.file-entry-name');
  assert.equal(name.textContent, '目录');
  await act(() =>
    name.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 })),
  );
  assert.deepEqual(opened, []);
  await act(() =>
    directory.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })),
  );
  props.lastPointer.current = 'touch';
  await act(() =>
    name.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 })),
  );
  props.longPress.current = true;
  await act(() =>
    name.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 })),
  );
  await act(() =>
    directory.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  assert.deepEqual(opened, ['/home/目录', '/home/目录', '/home/目录']);
  await act(() =>
    rows[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  assert.equal(opened.length, 3);
  await act(() =>
    directory.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }),
    ),
  );
  assert.deepEqual(context, ['目录']);
  await act(() => document.querySelector('.file-col-name button').click());
  assert.deepEqual(sorted, [{ key: 'name', desc: true }]);
});

test('resize hook preserves clamp, pointer release, collapse, keyboard and observer cleanup', async (t) => {
  const dom = setupDom(t),
    { document } = dom.window;
  const oldObserver = globalThis.ResizeObserver,
    element = document.querySelector('#files'),
    root = (dom.root = createRoot(element)),
    closed = [],
    observed = [];
  let resize,
    notify,
    disconnected = 0;
  Object.defineProperty(element.parentElement, 'clientWidth', { value: 1000 });
  element.parentElement.getBoundingClientRect = () => ({ right: 1000 });
  globalThis.ResizeObserver = class {
    constructor(callback) {
      notify = callback;
    }
    observe(target) {
      observed.push(target);
    }
    disconnect() {
      disconnected++;
    }
  };
  t.after(() => {
    globalThis.ResizeObserver = oldObserver;
  });
  function Harness() {
    resize = useFilePanelResize({
      workspaceRef: ref(element.parentElement),
      clearPress: () => {},
      setContext: () => {},
      setOpen: (value) => closed.push(value),
    });
    return null;
  }
  await act(() => root.render(h(Harness)));
  assert.equal(resize.visiblePanelWidth, 360);
  assert.deepEqual(observed, [element.parentElement]);
  const capture = new Set(),
    target = {
      setPointerCapture: (id) => capture.add(id),
      hasPointerCapture: (id) => capture.has(id),
      releasePointerCapture: (id) => capture.delete(id),
    },
    event = { button: 0, pointerId: 1, currentTarget: target, preventDefault() {} };
  await act(() => resize.resizerProps.onPointerDown(event));
  assert.equal(document.documentElement.classList.contains('terminal-files-resizing'), true);
  await act(() => resize.resizerProps.onPointerMove({ ...event, clientX: 20 }));
  assert.equal(resize.visiblePanelWidth, 700);
  await act(() => resize.resizerProps.onPointerMove({ ...event, clientX: 999 }));
  assert.deepEqual(closed, [false]);
  assert.equal(capture.size, 0);
  assert.equal(resize.visiblePanelWidth, 360);
  await act(() => resize.resizerProps.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }));
  assert.equal(resize.visiblePanelWidth, 380);
  await act(() => notify([{ contentRect: { width: 500 } }]));
  assert.equal(resize.visiblePanelWidth, 260);
  await act(() => root.unmount());
  assert.equal(disconnected, 1);
  assert.equal(document.documentElement.classList.contains('terminal-files-resizing'), false);
});

test('long-press captures the directory sequence and clears timers on unmount', async (t) => {
  const dom = setupDom(t),
    { document } = dom.window;
  const fixture = operationsFixture(),
    root = (dom.root = createRoot(document.querySelector('#files'))),
    menus = [];
  let interactions;
  function Harness() {
    interactions = useFileInteractions({
      ...fixture.options,
      context: null,
      setContext: (value) => menus.push(value),
    });
    return null;
  }
  await act(() => root.render(h(Harness)));
  const event = { pointerType: 'touch', clientX: 10, clientY: 20, stopPropagation() {} };
  interactions.touchStart(event, { name: 'one' });
  fixture.options.seq.current++;
  await new Promise((resolve) => setTimeout(resolve, 520));
  assert.deepEqual(menus, []);
  interactions.touchStart(event, { name: 'two' });
  await new Promise((resolve) => setTimeout(resolve, 520));
  assert.equal(menus[0].entry.name, 'two');
  assert.equal(interactions.longPress.current, true);
  interactions.touchStart(event, null);
  await act(() => root.unmount());
  assert.equal(interactions.press.current, null);
});

test('upload selection rejects stale picker contexts and captures the destination', async () => {
  const fixture = operationsFixture(),
    handlers = createFileUploadHandlers(fixture.options),
    event = selection([{ name: '文档.txt', size: 8 }]);
  fixture.options.seq.current++;
  await handlers.selected(event);
  assert.deepEqual(fixture.calls, []);
  assert.equal(event.target.value, '');
  assert.equal(fixture.options.pendingUpload.current, null);
  fixture.options.seq.current--;
  fixture.options.pendingUpload.current = fixture.context;
  await handlers.selected(selection([{ name: '文档.txt', size: 8 }]));
  const call = fixture.calls.find(([kind]) => kind === 'upload');
  assert.equal(call[2], '/home');
  assert.equal(call[3], '文档.txt');
  assert.deepEqual(fixture.calls.at(-1), ['load', '/home', undefined, { fresh: true }]);
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.options.upload.current, null);
});

test('old file-upload completion cannot mutate a replacement session UI or controller', async () => {
  const pending = deferred(),
    fixture = operationsFixture({ fileApi: { upload: () => pending.promise } }),
    handlers = createFileUploadHandlers(fixture.options),
    work = handlers.selected(selection([{ name: 'one.txt', size: 8 }]));
  assert.equal(fixture.state.busy, true);
  fixture.options.current.current = { id: 'two', generation: 3, connected: true };
  const replacement = new AbortController();
  fixture.options.upload.current = replacement;
  fixture.state.progress = { name: 'new-session', percent: 1 };
  pending.resolve();
  await work;
  assert.equal(fixture.state.busy, true);
  assert.equal(fixture.state.progress.name, 'new-session');
  assert.equal(fixture.options.upload.current, replacement);
  assert.deepEqual(fixture.calls, []);
});

test('folder upload cancellation retains written entries and refreshes the captured destination', async () => {
  const fixture = operationsFixture();
  fixture.options.fileApi.upload = async () => fixture.options.upload.current.abort();
  await createFileUploadHandlers(fixture.options).selectedFolder(
    selection([
      { name: 'a.txt', size: 1, webkitRelativePath: '项目/a.txt' },
      { name: 'b.txt', size: 1, webkitRelativePath: '项目/b.txt' },
    ]),
  );
  assert.match(fixture.state.error, /上传已取消；已上传的文件和已创建的目录会保留/);
  assert.deepEqual(fixture.calls[0].slice(0, 3), ['action', fixture.options.session, 'mkdir']);
  assert.deepEqual(fixture.calls.at(-1), ['load', '/home', undefined, { fresh: true }]);
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.state.progress, null);
});

test('delete confirmation and permission reads reject stale async continuations', async () => {
  const confirmation = deferred(),
    fixture = operationsFixture({ confirm: () => confirmation.promise }),
    handlers = createFileOperations(fixture.options),
    work = handlers.action('delete', { name: 'a.txt', type: 'file' }, fixture.context);
  fixture.options.directory.current = '/another';
  confirmation.resolve(true);
  await work;
  assert.deepEqual(fixture.calls, []);
  const permission = deferred(),
    second = operationsFixture({ fileApi: { permissions: () => permission.promise } }),
    reading = createFileOperations(second.options).advancedAction(
      'permissions',
      { name: 'a.txt', type: 'file' },
      second.context,
    );
  assert.equal(second.state.status, '正在读取权限…');
  second.options.taskEpoch.current++;
  second.state.status = 'replacement-task';
  permission.resolve({ mode: 0o644 });
  await reading;
  assert.equal(second.state.status, 'replacement-task');
  assert.equal(second.state.busy, true);
});

test('React name dialog keeps validation, cancellation and close cleanup', async (t) => {
  const dom = setupDom(t),
    document = dom.window.document;
  let result;
  await act(() => {
    result = askName('重命名', '初始.txt');
  });
  const input = document.querySelector('dialog input'),
    form = document.querySelector('dialog form');
  assert.equal(input.value, '初始.txt');
  assert.equal(input.maxLength, 255);
  await act(() => Simulate.change(input, { target: { value: '../invalid' } }));
  await act(() =>
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.match(document.querySelector('[role=alert]').textContent, /有效名称/);
  await act(() => Simulate.change(input, { target: { value: '新名称.txt' } }));
  await act(() =>
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(await result, '新名称.txt');
  assert.equal(document.querySelector('dialog'), null);
  let cancelled;
  await act(() => {
    cancelled = askName('新建文件夹');
  });
  await act(() => document.querySelector('.dialog-close').click());
  assert.equal(await cancelled, null);
});

test('cancelling an upload name conflict reports cancellation instead of success', async (t) => {
  const dom = setupDom(t),
    fixture = operationsFixture();
  fixture.options.data.entries = [{ name: 'exists.txt' }];
  let work;
  await act(() => {
    work = createFileUploadHandlers(fixture.options).selected(
      selection([
        { name: 'exists.txt', size: 1 },
        { name: 'new.txt', size: 1 },
      ]),
    );
  });
  await act(() => dom.window.document.querySelector('.dialog-close').click());
  await work;
  assert.equal(fixture.calls.filter(([kind]) => kind === 'upload').length, 0);
  assert.deepEqual(
    fixture.calls.find(([kind]) => kind === 'toast'),
    ['toast', '上传已取消'],
  );
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.options.upload.current, null);
});

test('cancelling a later preflight conflict does not enqueue any file from the batch', async (t) => {
  const dom = setupDom(t),
    fixture = operationsFixture();
  fixture.options.data.entries = [{ name: 'exists.txt' }];
  let work;
  await act(async () => {
    work = createFileUploadHandlers(fixture.options).selected(
      selection([
        { name: 'first.txt', size: 1 },
        { name: 'exists.txt', size: 1 },
        { name: 'last.txt', size: 1 },
      ]),
    );
  });
  await act(() => dom.window.document.querySelector('.dialog-close').click());
  await work;
  assert.deepEqual(
    fixture.calls.filter(([kind]) => kind === 'upload').map((call) => call[3]),
    [],
  );
  assert.deepEqual(
    fixture.calls.find(([kind]) => kind === 'toast'),
    ['toast', '上传已取消'],
  );
  assert.deepEqual(fixture.calls.at(-1), ['load', '/home', undefined, { fresh: true }]);
  assert.equal(fixture.state.busy, false);
});
