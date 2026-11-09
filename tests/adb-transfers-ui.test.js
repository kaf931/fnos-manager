import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { act, createElement } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { remoteFixture, deferred } from './helpers/remote-react-fixture.js';
const compiled = await build({
  entryPoints: ['web/adb-files.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
function fixture(t) {
  const ui = remoteFixture(t),
    render = ui.render;
  ui.render = (...args) =>
    act(async () => {
      await render(...args);
    });
  return ui;
}
test('ADB transfers preserve CSRF and allow cancellation while rejecting a concurrent transfer', async (t) => {
  const ui = fixture(t),
    original = globalThis.fetch;
  let state,
    signal,
    requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    signal = options.signal;
    assert.equal(options.headers['x-deskicons-token'], 'safe-token');
    return new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  function Probe() {
    state = module.exports.useAdbTransfers('s', () => 'safe-token');
    return createElement(module.exports.AdbTransfers, { items: state.items, cancel: state.cancel });
  }
  await ui.render(Probe, {});
  let upload;
  await act(async () => {
    upload = state.run('upload', '/sdcard/a', new Blob(['a']));
    upload.catch(() => {});
  });
  await assert.rejects(state.run('upload', '/sdcard/b', new Blob(['b'])), /等待当前传输/);
  assert.equal(requests, 1);
  await act(async () => {
    state.cancel();
    await assert.rejects(upload, /传输已取消/);
  });
  assert.equal(signal.aborted, true);
  assert.match(ui.document.body.textContent, /已取消/);
});
test('ADB transfer size limit fails before network activity and session replacement aborts work', async (t) => {
  const ui = fixture(t),
    original = globalThis.fetch;
  let state,
    signal,
    requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    signal = options.signal;
    return new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  function Probe({ id }) {
    state = module.exports.useAdbTransfers(id);
    return null;
  }
  await ui.render(Probe, { id: 'one' });
  await assert.rejects(state.run('install', '', { size: 256 * 1024 * 1024 + 1 }), /256 MiB/);
  assert.equal(requests, 0);
  let upload;
  await act(async () => {
    upload = state.run('upload', '/sdcard/a', new Blob(['a']));
    upload.catch(() => {});
  });
  await ui.render(Probe, { id: 'two' });
  await act(async () => {
    await assert.rejects(upload, /传输已取消/);
  });
  assert.equal(signal.aborted, true);
  assert.deepEqual(state.items, []);
});
test('ADB file navigation ignores a late response from the preceding directory', async (t) => {
  const ui = fixture(t),
    first = deferred(),
    second = deferred();
  const api = async (url) => (url.includes('DCIM') ? second.promise : first.promise);
  await ui.render(module.exports.AdbFiles, {
    sessionId: 's',
    api,
    toast() {},
    transfer: async () => {},
  });
  await act(async () => {
    const input = ui.document.querySelector('[aria-label="Android 文件路径"]');
    input.value = '/sdcard/DCIM';
    Simulate.change(input);
  });
  await act(async () =>
    ui.document
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.match(ui.document.body.textContent, /正在读取/);
  await act(async () =>
    second.resolve({
      path: '/sdcard/DCIM',
      items: [{ name: 'photo.jpg', path: '/sdcard/DCIM/photo.jpg', type: 'file', size: 10 }],
    }),
  );
  await act(async () =>
    first.resolve({
      path: '/sdcard',
      items: [{ name: 'old-directory', path: '/sdcard/old-directory', type: 'directory' }],
    }),
  );
  assert.match(ui.document.body.textContent, /photo.jpg/);
  assert.doesNotMatch(ui.document.body.textContent, /old-directory/);
  assert.equal(ui.document.querySelector('[aria-label="Android 文件路径"]').value, '/sdcard/DCIM');
});

test('ADB file panel uses SSH path controls, listing columns and context actions', async (t) => {
  const ui = fixture(t);
  await ui.render(module.exports.AdbFiles, {
    sessionId: 's',
    api: async () => ({
      path: '/sdcard',
      items: [
        {
          name: 'note.txt',
          path: '/sdcard/note.txt',
          type: 'file',
          size: 20,
          mtime: 1700000000000,
        },
      ],
    }),
    toast() {},
    transfer: async () => {},
  });
  assert.ok(ui.document.querySelector('form.terminal-files-path'));
  const buttons = [...ui.document.querySelectorAll('form.terminal-files-path > button')];
  assert.equal(buttons.at(-2).getAttribute('aria-label'), '应用安装');
  assert.equal(buttons.at(-1).getAttribute('aria-label'), '刷新目录');
  assert.deepEqual(
    [...ui.document.querySelectorAll('th')].map((n) => n.textContent.replace(/ [↑↓]$/, '')),
    ['名称', '类型', '大小', '修改时间'],
  );
  assert.equal(ui.document.querySelector('[aria-label="删除 note.txt"]'), null);
  const row = ui.document.querySelector('tbody tr');
  await act(() => Simulate.contextMenu(row, { clientX: 20, clientY: 30 }));
  assert.match(ui.document.body.textContent, /下载/);
  assert.match(ui.document.body.textContent, /重命名/);
  // Semi waits up to 100 ms for popup geometry; JSDOM has no layout.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  await ui.unmount();
});

test('file toolbar installation uses the existing APK transfer without submitting path navigation', async (t) => {
  const ui = fixture(t),
    sent = [];
  let reads = 0;
  await ui.render(module.exports.AdbFiles, {
    sessionId: 's',
    api: async () => {
      reads++;
      return { path: '/sdcard', items: [] };
    },
    toast() {},
    transfer: async (...args) => {
      sent.push(args);
    },
  });
  await act(() => ui.document.querySelector('button[aria-label="应用安装"]').click());
  const dialog = ui.document.querySelector('dialog[open]');
  assert.ok(dialog);
  assert.equal(dialog.dataset.dialogSize, 'small');
  assert.ok(dialog.querySelector('.task-form-body'));
  assert.equal(dialog.querySelector('[aria-label="选择 APK"]').hidden, true);
  assert.equal(dialog.querySelectorAll('.dialog-footer').length, 1);
  const input = dialog.querySelector('[aria-label="选择 APK"]'),
    file = new window.File(['apk'], 'test.apk', {
      type: 'application/vnd.android.package-archive',
    });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(() => Simulate.change(input));
  await act(() =>
    dialog
      .querySelector('form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'install');
  assert.equal(sent[0][2], file);
  assert.equal(reads, 1);
  assert.equal(ui.document.querySelector('dialog[open]'), null);
});

test('finishing an upload never navigates back to the directory it started in', async (t) => {
  const ui = fixture(t),
    pending = deferred(),
    paths = [];
  await ui.render(module.exports.AdbFiles, {
    sessionId: 's',
    toast() {},
    transfer: () => pending.promise,
    api: async (url) => {
      const path = new URL(url, 'http://localhost/').searchParams.get('path');
      paths.push(path);
      return { path, items: [] };
    },
  });
  const input = ui.document.querySelector('[aria-label="上传 Android 文件"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new window.File(['test'], 'test.txt')],
  });
  await act(() => Simulate.change(input));
  await act(() => {
    const field = ui.document.querySelector('[aria-label="Android 文件路径"]');
    field.value = '/sdcard/DCIM';
    Simulate.change(field);
  });
  await act(() =>
    ui.document
      .querySelector('form.terminal-files-path')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () => pending.resolve());
  assert.equal(ui.document.querySelector('[aria-label="Android 文件路径"]').value, '/sdcard/DCIM');
  assert.deepEqual(paths, ['/sdcard', '/sdcard/DCIM']);
});
test('ADB file rename uses shared dialog body and reports failures inside the dialog', async (t) => {
  const ui = fixture(t),
    mutation = deferred();
  let writes = 0;
  await ui.render(module.exports.AdbFiles, {
    sessionId: 's',
    toast() {},
    transfer: async () => {},
    api: async (_url, method) => {
      if (method === 'PUT') {
        writes++;
        return mutation.promise;
      }
      return {
        path: '/sdcard',
        items: [{ name: 'note.txt', path: '/sdcard/note.txt', type: 'file', size: 1 }],
      };
    },
  });
  await act(() =>
    Simulate.contextMenu(ui.document.querySelector('tbody tr'), { clientX: 20, clientY: 30 }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  await act(() =>
    [...ui.document.querySelectorAll('.semi-dropdown-item')]
      .find((node) => node.textContent === '重命名')
      .click(),
  );
  const dialog = ui.document.querySelector('dialog[open]');
  assert.equal(dialog.dataset.dialogSize, 'small');
  assert.ok(dialog.querySelector('.task-form-body'));
  const confirm = [...dialog.querySelectorAll('button')].find(
    (button) => button.textContent === '确认',
  );
  await act(() => {
    Simulate.click(confirm);
    Simulate.click(confirm);
  });
  assert.equal(writes, 1);
  await act(async () => mutation.reject(new Error('目标已存在')));
  assert.match(dialog.querySelector('[role="alert"]').textContent, /目标已存在/);
  assert.ok(dialog.open);
});

for (const kind of ['upload', 'install']) {
  test(`ADB ${kind} cancellation while reading its response cannot report completion`, async (t) => {
    const ui = fixture(t),
      previous = globalThis.fetch;
    let state;
    globalThis.fetch = async (_url, { signal }) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('response aborted'))),
        ),
    });
    t.after(() => {
      globalThis.fetch = previous;
    });
    function Probe() {
      state = module.exports.useAdbTransfers('s');
      return null;
    }
    await ui.render(Probe, {});
    let job;
    await act(async () => {
      job = state.run(kind, '/sdcard/test', new Blob(['test']));
      job.catch(() => {});
    });
    await act(async () => {
      state.cancel();
      await assert.rejects(job, /传输已取消/);
    });
    assert.equal(state.items[0].status, '已取消');
  });
}
test('ADB upload requires a valid completion acknowledgement', async (t) => {
  const ui = fixture(t),
    previous = globalThis.fetch;
  let state;
  t.after(() => {
    globalThis.fetch = previous;
  });
  function Probe() {
    state = module.exports.useAdbTransfers('s');
    return null;
  }
  await ui.render(Probe, {});
  for (const body of ['broken JSON', '{}']) {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    await act(async () => {
      await assert.rejects(state.run('upload', '/sdcard/test', new Blob(['test'])));
    });
    assert.equal(state.items.at(-1).status, '失败');
  }
});
