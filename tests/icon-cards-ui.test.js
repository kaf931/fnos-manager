import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';

// Bundle Semi's browser modules for Node while sharing the tested React runtime.
const built = await build({
  stdin: {
    contents:
      "export {IconCards} from './web/icon-cards.tsx'; export {ContainerList} from './web/container-list.tsx';",
    resolveDir: path.resolve(fileURLToPath(new URL('../', import.meta.url))),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'react-dom/client'],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  compiled,
  compiled.exports,
);
const { IconCards, ContainerList } = compiled.exports;

function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' }),
    previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const root = createRoot(document.querySelector('#root'));
  t.after(() => {
    root.unmount();
    Object.assign(globalThis, previous);
    dom.window.close();
  });
  return (node) => flushSync(() => root.render(node));
}

test('icon cards preserve safe text, dispatch each action, and disable installation while pending', (t) => {
  const render = mount(t),
    calls = [],
    entry = {
      id: 'entry',
      name: '<script>name</script>',
      url: 'http://nas/<b>text</b>',
      mode: 'url',
      containerId: null,
      revision: 2,
      appliedRevision: 0,
    },
    installing = new Map();
  const update = () =>
    render(
      React.createElement(IconCards, {
        entries: [entry],
        base: '/api',
        installing,
        onAction: (action, row) => calls.push([action, row.id]),
      }),
    );
  update();
  assert.equal(document.querySelector('h3').textContent, entry.name);
  assert.equal(document.querySelector('script'), null);
  assert.equal(document.querySelectorAll('img').length, 1);
  document.querySelector('[data-action="apply"]').click();
  assert.deepEqual(calls, [['apply', 'entry']]);
  installing.set(entry.id, 'installing');
  update();
  const apply = document.querySelector('[data-action="apply"]');
  assert.equal(apply.disabled, true);
  assert.equal(apply.textContent, '正在安装…');
  apply.click();
  assert.equal(calls.length, 1);
  installing.set(entry.id, 'retry');
  update();
  assert.equal(document.querySelector('[data-action="apply"]').textContent, '重试添加');
  assert.equal(document.querySelector('[data-action="apply"]').disabled, false);
  for (const action of ['edit', 'delete', 'package'])
    document.querySelector(`[data-action="${action}"]`).click();
  assert.deepEqual(calls.slice(1), [
    ['edit', 'entry'],
    ['delete', 'entry'],
    ['package', 'entry'],
  ]);
});

test('container icon refresh and failures remain React owned and selection stays stable', (t) => {
  const render = mount(t),
    icons = new Map(),
    selected = [],
    failed = [],
    containers = [
      {
        id: 'docker',
        name: '<b>NAS</b>',
        image: 'local/image',
        state: 'running',
        ports: [{ hostPort: 8080, containerPort: 80, hostIp: '' }],
        iconUrl: '',
        serviceUrl: '',
      },
    ];
  const update = () =>
    render(
      React.createElement(ContainerList, {
        containers,
        selectedId: 'docker',
        icons,
        onSelect: (id) => selected.push(id),
        onIconError: (id) => failed.push(id),
      }),
    );
  update();
  assert.equal(document.querySelector('strong').textContent, '<b>NAS</b>');
  assert.equal(document.querySelector('.container-icon').classList.contains('has-image'), false);
  assert.equal(document.querySelector('img').hidden, true);
  icons.set('docker', 'data:image/png;base64,aW1hZ2U=');
  update();
  assert.equal(document.querySelector('.container-icon').classList.contains('has-image'), true);
  assert.equal(document.querySelector('img').hidden, false);
  assert.equal(document.querySelector('.container-item').classList.contains('selected'), true);
  document.querySelector('img').dispatchEvent(new window.Event('error'));
  assert.deepEqual(failed, ['docker']);
  document.querySelector('.container-item').click();
  assert.deepEqual(selected, ['docker']);
});
