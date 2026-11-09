import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
async function bundledStorageModule(entry) {
  const { build } = await import('esbuild');
  const { writeFile, unlink } = await import('node:fs/promises');
  const output = new URL(`../.web-test/ui-${entry}-${process.pid}.mjs`, import.meta.url);
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../web/${entry}.tsx`, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    loader: { '.png': 'dataurl' },
    jsx: 'automatic',
    plugins: [
      {
        name: 'ui-library-test-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
          builder.onResolve({ filter: /^@douyinfe\/semi-ui/ }, () => ({
            path: 'semi',
            namespace: 'test-boundary',
          }));
          builder.onResolve({ filter: /task-pagination\.js$/ }, () => ({
            path: 'pagination',
            namespace: 'test-boundary',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'test-boundary' }, () => ({
            loader: 'js',
            contents: `import React from 'react'; export default function Sheet(props) { return props.visible === false ? null : React.createElement('aside', null, props.children); } export function TaskPagination() { return null; }`,
          }));
        },
      },
    ],
  });
  await writeFile(output, result.outputFiles[0].text);
  try {
    return await import(output.href);
  } finally {
    await unlink(output);
  }
}

test('scan result changes reject stale file pages and duplicate actions select only unprocessed groups', async (t) => {
  const dom = new JSDOM('<div id="scan"></div>');
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    CustomEvent: globalThis.CustomEvent,
    matchMedia: globalThis.matchMedia,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    CustomEvent: dom.window.CustomEvent,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  t.after(async () => {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  const { StorageScanView } = await bundledStorageModule('storage-scan-view');
  const pending = [];
  const host = document.querySelector('#scan');
  const root = createRoot(host);
  let selected = [];
  let props = {
    api: () => new Promise((resolve) => pending.push(resolve)),
    active: true,
    choose() {},
    start() {},
    cancel() {},
    openFolder() {},
    onMode() {},
    openHistory() {},
    onManage: (value) => {
      selected = value;
    },
  };
  const render = async (next) => {
    props = { ...props, ...next };
    await act(async () => root.render(React.createElement(StorageScanView, props)));
  };
  const scan = (id) => ({
    id,
    path: '/volume',
    mode: 'space',
    status: 'completed',
    startedAt: '2026-10-20T00:00:00Z',
    progress: { files: 1, bytes: 4 },
    result: { catalog: [] },
  });
  await render({ mode: 'space', path: '/volume', job: scan('old') });
  await render({ job: scan('current') });
  pending[1]({
    total: 1,
    items: [
      {
        path: '/volume/current',
        name: 'current',
        type: 'file',
        bytes: 4,
        size: 4,
        modifiedAt: 1,
        extension: '',
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  pending[0]({
    total: 1,
    items: [
      {
        path: '/volume/stale',
        name: 'stale',
        type: 'file',
        bytes: 4,
        size: 4,
        modifiedAt: 1,
        extension: '',
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(host.querySelector('tbody').textContent, /current/);
  assert.doesNotMatch(host.querySelector('tbody').textContent, /stale/);
  const groups = [
    { paths: ['/keep', '/already-processed'], size: 4 },
    { paths: ['/keeper', '/copy'], size: 8 },
  ];
  await render({
    mode: 'duplicates',
    path: '/volume',
    job: {
      ...scan('duplicates'),
      mode: 'duplicates',
      result: { groups },
      duplicateActions: [
        {
          path: '/already-processed',
          keep: '/keep',
          action: 'delete',
          success: true,
          at: '2026-10-21T00:00:00Z',
        },
      ],
    },
  });
  await act(async () => host.querySelector('[data-group-all]').click());
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === '批量管理').click(),
  );
  assert.deepEqual(
    selected.map((g) => g.paths),
    [['/keeper', '/copy']],
  );
  assert.equal(groups[0].paths.length, 2);
  assert.equal(selected.length, 1);
  await render({ job: { ...props.job, id: 'next-scan' } });
  assert.equal(host.querySelector('[data-group-select]').checked, false);
});

test('duplicate mutation payload matches the controllers strict nested DTO whitelist', async () => {
  await import('reflect-metadata');
  const { plainToInstance } = await import('class-transformer');
  const { validate } = await import('class-validator');
  const { DuplicateActionDto } = await import('../server/app/storage/dto.js');
  const { duplicateProcessRequest } = await import('../.web-test/storage-scan-model.js');
  const options = { whitelist: true, forbidNonWhitelisted: true };
  const request = duplicateProcessRequest('delete', '', [
    { keep: '/volume/keeper', path: '/volume/copy', size: 32 },
  ]);
  assert.deepEqual(request.items, [{ keep: '/volume/keeper', path: '/volume/copy' }]);
  assert.deepEqual(await validate(plainToInstance(DuplicateActionDto, request), options), []);
  const forbidden = { ...request, items: [{ ...request.items[0], size: 32 }] };
  assert.notEqual(
    (await validate(plainToInstance(DuplicateActionDto, forbidden), options)).length,
    0,
  );
});

test('rename preview DTO preserves the shared 500 file selection limit', async () => {
  await import('reflect-metadata');
  const { plainToInstance } = await import('class-transformer');
  const { validate } = await import('class-validator');
  const { RenamePreviewDto } = await import('../server/app/storage/dto.js');
  const options = { whitelist: true, forbidNonWhitelisted: true };
  for (const count of [201, 500]) {
    assert.deepEqual(
      await validate(
        plainToInstance(RenamePreviewDto, {
          path: '/volume',
          names: Array.from({ length: count }, (_, i) => `file-${i}.txt`),
        }),
        options,
      ),
      [],
    );
  }
  assert.notEqual(
    (
      await validate(
        plainToInstance(RenamePreviewDto, {
          path: '/volume',
          names: Array.from({ length: 501 }, (_, i) => `file-${i}.txt`),
        }),
        options,
      )
    ).length,
    0,
  );
});
