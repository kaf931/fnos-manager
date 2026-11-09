import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
const output = await build({
  stdin: {
    contents:
      "export {StorageScanView} from './web/storage-scan-view.tsx';export {StorageAttachments} from './web/storage-attachments.tsx';export {StorageRename} from './web/storage-rename.tsx';export {StorageHistory} from './web/storage-history.tsx';export {HistoryLimitsDialog} from './web/storage-cleanup.tsx';export {ConfirmationHost} from './web/confirmation.tsx';export {StoragePage} from './web/features/storage/page.tsx';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.png': 'dataurl' },
  plugins: [
    {
      name: 'ui-boundaries',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({ path: 'semi', namespace: 'stub' }));
        b.onResolve({ filter: /task-pagination\.js$/ }, () => ({
          path: 'pagination',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents:
            "import React from 'react';export default function Pass(p){return React.createElement(React.Fragment,null,p.children);} export function TaskPagination(){return null;}",
        }));
      },
    },
  ],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { StoragePage, StorageAttachments, StorageRename, StorageHistory, HistoryLimitsDialog } =
  module.exports;
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t, Component, props, mobile = false) {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const values = {
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    matchMedia: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  dom.window.matchMedia = globalThis.matchMedia;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const root = createRoot(document.querySelector('main'));
  let current = props,
    unmounted = false;
  const render = async (next = {}) => {
    current = { ...current, ...next };
    await act(async () => root.render(React.createElement(Component, current)));
  };
  const unmount = async () => {
    if (!unmounted) {
      unmounted = true;
      await act(async () => root.unmount());
    }
  };
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  await render();
  return { render, unmount };
}
const tick = async (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
test('rename preview finishing while hidden releases operation controls on return', async (t) => {
  const pending = defer();
  const ui = await fixture(t, StorageRename, {
    active: true,
    path: '/files',
    toast() {},
    onChoose() {},
    onPath() {},
    api: async (route) =>
      route === '/storage/rename/previews'
        ? pending.promise
        : { items: [{ name: 'one.txt', type: 'file', size: 4 }] },
  });
  await act(() => document.querySelector('[data-name="one.txt"]').click());
  await act(() => document.querySelector('[aria-label="批量管理"]').click());
  await act(() => document.querySelector('[data-preview]').click());
  await ui.render({ active: false });
  await act(() => pending.resolve({ id: 'old', entries: [], changed: 0, conflicts: 0 }));
  await ui.render({ active: true });
  assert.equal(document.querySelector('[data-name="one.txt"]').disabled, false);
  assert.equal(document.querySelector('[aria-label="选择整理目录"]').disabled, false);
});

test('file organization keeps the public desktop pagination visible for an empty directory', async (t) => {
  await fixture(t, StorageRename, {
    active: true,
    path: '/empty',
    api: async () => ({ items: [] }),
    toast() {},
    onChoose() {},
    onPath() {},
  });
  assert.equal(document.querySelector('[data-pagination]').hidden, false);
});
test('leaving file organization during directory navigation does not lock navigation after returning', async (t) => {
  const pending = defer();
  let visits = 0;
  const ui = await fixture(t, StorageRename, {
    active: true,
    path: '/files',
    toast() {},
    onChoose() {},
    onPath() {},
    api: async (route) => {
      if (route.includes(encodeURIComponent('/files/child'))) {
        visits++;
        if (visits === 1) return pending.promise;
      }
      return { items: [{ name: 'child', type: 'directory', size: 0 }] };
    },
  });
  await act(async () => document.querySelector('[data-directory="child"]').click());
  assert.equal(visits, 1);
  await ui.render({ active: false });
  await act(async () => pending.resolve({ items: [] }));
  await ui.render({ active: true });
  await act(async () => document.querySelector('[data-directory="child"]').click());
  assert.equal(visits, 2, 'returning to the menu must allow entering folders again');
});
test('attachment requests and confirmation scopes are disposed when the React panel becomes inactive', async (t) => {
  const pending = defer();
  let reads = 0;
  const ui = await fixture(t, StorageAttachments, {
    active: true,
    api: () => {
      reads++;
      return pending.promise;
    },
    toast() {},
    onChanged() {},
  });
  await tick(180);
  assert.equal(reads, 1);
  await ui.render({ active: false });
  await act(async () =>
    pending.resolve({
      items: [
        { id: 'late', name: 'late.txt', kind: 'text', size: 1, createdAt: 0, chatTitle: 'late' },
      ],
      total: 1,
    }),
  );
  assert.doesNotMatch(document.body.textContent, /late.txt/);
  await ui.unmount();
  await tick(180);
  assert.equal(reads, 1);
});
test('closing rename preview rejects its late result', async (t) => {
  const preview = defer();
  let writes = 0;
  const files = Array.from({ length: 501 }, (_, i) => ({
    name: `f-${i}.txt`,
    type: 'file',
    size: 1,
    modifiedAt: 0,
  }));
  const ui = await fixture(t, StorageRename, {
    active: true,
    path: '/files',
    toast() {},
    onChoose() {},
    onPath() {},
    api: async (path, method) => {
      if (path.includes('/files?')) return { items: files };
      if (path === '/storage/rename/previews') return preview.promise;
      writes++;
      return {};
    },
  });
  assert.ok(document.querySelector('.storage-rename-list thead th:first-child [data-all]'));
  assert.ok(document.querySelector('.storage-rename-list tbody td:first-child [data-name]'));
  await act(async () => document.querySelector('[data-name]').click());
  await act(async () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '批量管理').click(),
  );
  await act(async () => document.querySelector('[data-preview]').click());
  await ui.render({ active: false });
  await act(async () =>
    preview.resolve({
      id: 'late',
      entries: [{ from: 'a', to: 'late-preview' }],
      changed: 1,
      conflicts: 0,
    }),
  );
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(writes, 0);
});
test('history restore finishing after React deactivation cannot navigate to a saved scan', async (t) => {
  const detail = defer();
  let restored = 0;
  const row = {
    id: 's',
    path: '/volume',
    mode: 'space',
    status: 'completed',
    startedAt: '2026-10-25T00:00:00Z',
    progress: { files: 1, bytes: 1 },
  };
  const ui = await fixture(t, StorageHistory, {
    active: true,
    toast() {},
    onSelect() {
      restored++;
    },
    api: async (path) => (path.includes('?') ? { items: [row], total: 1 } : detail.promise),
  });
  await act(async () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '查看结果').click(),
  );
  await ui.render({ active: false });
  await act(async () => detail.resolve({ ...row, result: { catalog: [] } }));
  assert.equal(restored, 0);
});
test('retention settings unmount cancels late load without reopening a dialog', async (t) => {
  const pending = defer();
  const ui = await fixture(t, HistoryLimitsDialog, {
    api: () => pending.promise,
    toast() {},
    onSaved() {},
    onClose() {},
  });
  assert.ok(document.querySelector('dialog[open]'));
  await ui.unmount();
  await act(async () => pending.resolve({ scans: 20, renames: 20, serviceLogMiB: 1 }));
  assert.equal(document.querySelector('dialog'), null);
});

test('React organizer caps rapid file selection at 500 before preview submission', async (t) => {
  const files = Array.from({ length: 501 }, (_, i) => ({
    name: `file-${i}.txt`,
    type: 'file',
    size: 1,
    modifiedAt: 0,
  }));
  let submitted;
  await fixture(
    t,
    StorageRename,
    {
      active: true,
      path: '/files',
      toast() {},
      onChoose() {},
      onPath() {},
      api: async (path, method, body) => {
        if (path.includes('/files?')) return { items: files };
        submitted = body;
        return { id: 'preview', entries: [], changed: 500, conflicts: 0 };
      },
    },
    true,
  );
  await act(async () => {
    for (const checkbox of document.querySelectorAll('.storage-rename-mobile [data-name]'))
      checkbox.click();
  });
  assert.equal(document.querySelectorAll('.storage-rename-mobile [data-name]:checked').length, 500);
  await act(async () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '批量管理').click(),
  );
  await act(async () => document.querySelector('[data-preview]').click());
  assert.equal(submitted.names.length, 500);
});

test('storage navigation closes the picker and rejects a directory reply from the previous view', async (t) => {
  const pending = defer();
  const ui = await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        if (path === '/storage/scans') return [];
        if (path.startsWith('/storage/directories')) return pending.promise;
        if (path === '/storage/cleanup') return { items: [], limits: {} };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((row) => row.textContent.includes('文件整理'))
      .querySelector('button')
      .click(),
  );
  await act(async () => document.querySelector('[aria-label="选择整理目录"]').click());
  assert.deepEqual(
    [...document.querySelectorAll('.storage-workspace-modes [data-storage-mode]')].map(
      (button) => button.dataset.storageMode,
    ),
    ['space', 'duplicates', 'rename', 'cleanup'],
  );
  assert.ok(document.querySelector('#storage-picker[open]'));
  await act(async () => document.querySelector('[data-storage-mode="cleanup"]').click());
  await act(async () =>
    pending.resolve({
      path: '/late',
      parent: null,
      items: [{ path: '/late/child', name: 'late-directory' }],
    }),
  );
  assert.equal(document.querySelector('#storage-picker'), null);
  assert.doesNotMatch(document.body.textContent, /late-directory/);
  await ui.render({ active: false });
});

test('cleanup React page opens retention settings through its configuration action', async (t) => {
  const paths = [];
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        paths.push(path);
        if (path === '/storage/scans') return [];
        if (path === '/storage/cleanup') return { items: [], limits: {} };
        if (path === '/storage/cleanup/settings')
          return { scans: 50, renames: 100, serviceLogMiB: 10 };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((row) => row.textContent.includes('应用清理'))
      .querySelector('button')
      .click(),
  );
  await act(async () => document.querySelector('[aria-label="配置保留上限"]').click());
  assert.ok(document.querySelector('dialog[open]'));
  assert.ok(paths.includes('/storage/cleanup/settings'));
  assert.equal(document.querySelector('#history-limit-scans').value, '50');
  const { readFile } = await import('node:fs/promises');
  assert.ok(!(await readFile('web/system-settings.tsx', 'utf8')).includes('HistoryLimitSettings'));
});

test('record drilldown returns to application cleanup and keeps history entrypoints centralized', async (t) => {
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        if (path === '/storage/scans') return [];
        if (path === '/storage/cleanup')
          return {
            items: [{ kind: 'scans', count: 1, protected: 0, bytes: null }],
            limits: { scans: 50 },
          };
        if (path.startsWith('/storage/scans?')) return { items: [], total: 0 };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((r) => r.textContent.includes('应用清理'))
      .querySelector('button')
      .click(),
  );
  await act(async () => document.querySelector('[aria-label="查看扫描记录"]').click());
  assert.equal(document.querySelector('#storage-menu-title').textContent, '扫描记录');
  assert.ok(
    document.querySelector('.storage-history-table thead th:first-child input[type=checkbox]'),
  );
  await act(async () => document.querySelector('#storage-back').click());
  assert.equal(document.querySelector('#storage-menu-title')?.textContent, '应用清理');
  await act(async () => document.querySelector('[data-storage-mode="rename"]').click());
  const toolbar = document.querySelector('.storage-workspace-toolbar');
  assert.ok(toolbar.querySelector('[aria-label="选择整理目录"]'));
  assert.equal(
    toolbar.querySelector('.storage-workspace-actions').lastElementChild.id,
    'storage-reload',
  );
  assert.doesNotMatch(toolbar.textContent, /改名记录/);
});

test('cancelled scan without a result leaves the running screen', async (t) => {
  const { StorageScanView } = module.exports;
  const props = {
    mode: 'space',
    path: '/files',
    active: true,
    job: { id: 'running', path: '/files', mode: 'space', status: 'running', progress: {} },
    api: async () => ({ items: [], total: 0 }),
    choose() {},
    start() {},
    cancel() {},
    openFolder() {},
    onMode() {},
    onManage() {},
  };
  const ui = await fixture(t, StorageScanView, props);
  assert.equal(document.querySelector('.storage-scan-progress').hidden, false);
  await ui.render({ job: { ...props.job, status: 'cancelled' } });
  assert.equal(document.querySelector('.storage-scan-progress').hidden, true);
});

test('a running scan opened from history keeps polling even when a newer scan has completed', async (t) => {
  const old = {
    id: 'old',
    mode: 'space',
    path: '/old',
    status: 'running',
    progress: {},
    startedAt: '2026-10-25T00:00:00Z',
  };
  const latest = {
    ...old,
    id: 'latest',
    path: '/latest',
    status: 'completed',
    result: { catalog: [] },
  };
  let reads = 0;
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        if (path === '/storage/scans') return [latest, old];
        if (path === '/storage/scans/latest') return latest;
        if (path === '/storage/scans/old') {
          reads++;
          return old;
        }
        if (path.startsWith('/storage/scans?')) return { items: [old], total: 1 };
        if (path === '/storage/cleanup')
          return {
            items: [{ kind: 'scans', count: 2, protected: 1, bytes: null }],
            limits: { scans: 50 },
          };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((r) => r.textContent.includes('应用清理'))
      .querySelector('button')
      .click(),
  );
  await act(async () => document.querySelector('[aria-label="查看扫描记录"]').click());
  await act(async () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === '查看结果').click(),
  );
  const before = reads;
  await tick(1050);
  assert.ok(
    reads > before,
    'the selected running scan must be polled independently of the newest scan',
  );
});

test('organizing files directly reuses the latest scanned directory without opening analysis first', async (t) => {
  const scan = {
    id: 'latest',
    mode: 'space',
    path: '/media',
    status: 'completed',
    progress: { files: 1 },
    result: { catalog: [] },
    startedAt: '2026-10-25T00:00:00Z',
  };
  const calls = [];
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        calls.push(path);
        if (path === '/storage/scans') return [scan];
        if (path === '/storage/scans/latest') return scan;
        if (path.startsWith('/storage/rename/files?'))
          return { items: [{ name: 'photo.jpg', type: 'file', size: 10, modifiedAt: 0 }] };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((r) => r.textContent.includes('文件整理'))
      .querySelector('button')
      .click(),
  );
  await tick();
  assert.ok(calls.includes('/storage/rename/files?path=%2Fmedia'));
  assert.match(document.querySelector('#storage-organize').textContent, /photo.jpg/);
});

test('space record management keeps actions, table and pagination inside its padded modal', async (t) => {
  const scan = {
    id: 'space-scan',
    mode: 'space',
    path: '/files',
    status: 'completed',
    progress: { files: 1, bytes: 10 },
    result: { files: 1, bytes: 10, catalog: [] },
    startedAt: '2026-10-25T00:00:00Z',
  };
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        if (path === '/storage/scans') return [scan];
        if (path === '/storage/scans/space-scan') return scan;
        if (path.startsWith('/storage/scans?')) {
          assert.match(path, /mode=space/);
          return { items: [scan], total: 1 };
        }
        if (path.includes('/entries?')) return { items: [], total: 0 };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-card button')]
      .find((b) => b.textContent === '查看结果')
      .click(),
  );
  await tick();
  await act(async () => document.querySelector('[aria-label="批量管理"]').click());
  const modal = document.querySelector('.storage-record-manager[open]');
  assert.ok(modal.querySelector(':scope > .task-form-body > .storage-history-inline'));
  assert.ok(modal.querySelector('[aria-label="删除所选记录"]'));
  assert.equal(modal.querySelector('[aria-label="对比所选两次扫描"]'), null);
  assert.ok(modal.querySelector('.history-pagination'));
  await act(async () => modal.querySelector('[aria-label="选择当前页记录"]').click());
  assert.equal(modal.querySelector('[aria-label="删除所选记录"]').disabled, false);
});

test('duplicate view without a scan stays on the shared empty table when the shared directory changes', async (t) => {
  const { StorageScanView } = module.exports;
  let stage;
  const ui = await fixture(t, StorageScanView, {
    mode: 'duplicates',
    path: '/media',
    job: null,
    active: true,
    api: async () => ({ items: [], total: 0 }),
    choose() {},
    cancel() {},
    openFolder() {},
    onManage() {},
    onStage(value) {
      stage = value;
    },
  });
  assert.equal(stage, 'details');
  assert.ok(document.querySelector('.storage-scan-details:not([hidden]) .storage-duplicate-table'));
  assert.match(
    document.querySelector('.storage-duplicate-table tbody').textContent,
    /暂无重复检查记录/,
  );
  assert.equal(document.querySelector('.storage-scan-home'), null);
  await ui.render({ path: '/other' });
  assert.equal(stage, 'details');
  assert.equal(document.querySelector('.storage-scan-details').hidden, false);
  assert.equal(document.querySelector('[aria-label="批量管理"]').disabled, true);
});
test('empty duplicate workspace keeps its title and icon rail instead of the old scan entrance', async (t) => {
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path) => {
        if (path === '/storage/scans') return [];
        return { items: [], total: 0 };
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((r) => r.textContent.includes('文件整理'))
      .querySelector('button')
      .click(),
  );
  await act(async () => document.querySelector('[data-storage-mode="duplicates"]').click());
  assert.equal(document.querySelector('#storage-menu-title').textContent, '重复文件');
  assert.equal(document.querySelector('.storage-workspace-toolbar').hidden, false);
  assert.equal(
    document.querySelector('#storage-page').classList.contains('storage-overview'),
    false,
  );
  assert.ok(document.querySelector('.storage-duplicate-table'));
  assert.ok(document.querySelector('.storage-workspace-toolbar [aria-label="更换目录"]'));
  assert.equal(document.querySelector('[aria-label="重复文件分页"]').hidden, false);
});

test('duplicate directory action starts a check only after confirming a directory', async (t) => {
  const writes = [];
  const running = {
    id: 'running-check',
    path: '/selected',
    mode: 'duplicates',
    status: 'running',
    progress: { files: 0, bytes: 0, hashedBytes: 0, directories: 0 },
  };
  await fixture(t, StoragePage, {
    active: true,
    services: {
      toast() {},
      api: async (path, method, body) => {
        if (path === '/storage/scans' && method === 'POST') {
          writes.push(body);
          return running;
        }
        if (path === '/storage/scans') return [];
        if (path === '/storage/scans/running-check') return running;
        if (path.startsWith('/storage/directories'))
          return { path: '/selected', parent: null, items: [], truncated: false };
        if (path.startsWith('/storage/rename/files')) return { items: [] };
        throw Error(path);
      },
    },
  });
  await act(async () =>
    [...document.querySelectorAll('.storage-entry-row')]
      .find((r) => r.textContent.includes('文件整理'))
      .querySelector('button')
      .click(),
  );
  await act(async () => document.querySelector('[data-storage-mode="duplicates"]').click());
  await act(async () => document.querySelector('[aria-label="更换目录"]').click());
  await tick();
  assert.ok(document.querySelector('#storage-picker[open]'));
  assert.equal(writes.length, 0);
  await act(async () => document.querySelector('#storage-use-directory').click());
  await tick();
  assert.deepEqual(writes, [{ path: '/selected', mode: 'duplicates' }]);
});

for (const mobile of [false, true])
  test(`duplicate selections are first in ${mobile ? 'mobile rows' : 'desktop columns'}`, async (t) => {
    const { StorageScanView } = module.exports;
    await fixture(
      t,
      StorageScanView,
      {
        mode: 'duplicates',
        path: '/files',
        active: true,
        job: {
          id: 'dup',
          mode: 'duplicates',
          path: '/files',
          status: 'completed',
          progress: { files: 2 },
          result: { groups: [{ paths: ['/files/a.txt', '/files/b.txt'], size: 2, count: 2 }] },
        },
        api: async () => ({ items: [], total: 0 }),
        choose() {},
        cancel() {},
        openFolder() {},
        onManage() {},
      },
      mobile,
    );
    if (mobile)
      assert.equal(
        document.querySelector('.storage-detail-cards .history-compact-row').firstElementChild.type,
        'checkbox',
      );
    else {
      assert.ok(document.querySelector('.storage-duplicate-table thead th:first-child input'));
      assert.ok(
        document
          .querySelector('.storage-duplicate-table tbody tr')
          .firstElementChild.querySelector('input'),
      );
    }
  });
test('attachment table selection is the leading column', async (t) => {
  await fixture(t, StorageAttachments, {
    active: true,
    toast() {},
    onChanged() {},
    api: async () => ({
      items: [{ id: 'a', name: 'a.txt', kind: 'text', size: 1, createdAt: 0, chatTitle: 'chat' }],
      total: 1,
    }),
  });
  await tick(180);
  assert.ok(document.querySelector('.storage-history-table thead th:first-child input'));
  assert.ok(
    document
      .querySelector('.storage-history-table tbody tr')
      .firstElementChild.querySelector('input'),
  );
});
