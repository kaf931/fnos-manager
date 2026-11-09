import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
const built = await build({
  stdin: {
    contents:
      "export {openTextEditor} from './web/terminal-text-editor.tsx';export {RemoteDialogHost} from './web/features/terminal/dialogs.tsx';",
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
      name: 'ui-boundaries',
      setup(b) {
        b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (a) => ({
          path: a.path,
          external: true,
        }));
        b.onResolve({ filter: /native-select\.js$/ }, () => ({
          path: 'select',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents:
            "import React from 'react';export const NativeSelect=()=>React.createElement('span',null,'encoding');",
        }));
        b.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: '' }));
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
const { openTextEditor, RemoteDialogHost } = module.exports;
const tick = () => new Promise((r) => setTimeout(r, 10));
async function editorFixture(t, overrides = {}) {
  const dom = new JSDOM('<main/>', { pretendToBeVisual: true });
  const globals = {
    CustomEvent: dom.window.CustomEvent,
    window: dom.window,
    Window: dom.window.Window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    matchMedia: () => ({ matches: false }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const old = {};
  for (const [key, value] of Object.entries(globals)) {
    old[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
  const root = createRoot(document.querySelector('main'));
  await act(() => root.render(createElement(RemoteDialogHost)));
  t.after(async () => {
    await act(async () => {
      root.unmount();
      await tick();
    });
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (old[key]) Object.defineProperty(globalThis, key, old[key]);
      else delete globalThis[key];
    }
  });
  const file = {
    content: 'first\r\nsecond',
    encoding: 'utf8',
    bom: false,
    revision: 'a'.repeat(64),
    size: 13,
  };
  const state = {
    connected: true,
    accept: false,
    confirmations: 0,
    saves: [],
    deleted: [],
    reads: 0,
    current: file,
    historical: {
      ...file,
      content: 'history\r\nsecond',
      encoding: 'utf16le',
      bom: true,
      revision: 'old-version',
    },
  };
  const fileApi = {
    readText: async () => {
      state.reads++;
      return state.current;
    },
    saveText: async (_s, _p, input, backup) => {
      state.saves.push({ ...input, backup });
      throw Error('保存冲突');
    },
    textVersions: async () => ({
      items: [
        { id: 'v1', createdAt: '2026-10-24T00:00:00Z', size: 30, encoding: 'utf16le', bom: true },
      ],
    }),
    readTextVersion: async () => state.historical,
    deleteTextVersion: async (_s, _p, id) => {
      state.deleted.push(id);
    },
  };
  Object.assign(fileApi, overrides);
  await act(async () => {
    openTextEditor({
      fileApi,
      session: { id: 'one', generation: 1, connected: true },
      path: '/test.txt',
      name: 'test.txt',
      valid: () => state.connected,
      confirm: async () => {
        state.confirmations++;
        return state.accept;
      },
      toast: () => {},
      onSaved: () => {},
    });
    await tick();
  });
  const editor = EditorView.findFromDOM(document.querySelector('.cm-editor'));
  const button = (text) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === text);
  const click = async (text) =>
    act(async () => {
      assert.ok(button(text), text);
      button(text).click();
      await tick();
    });
  const edit = async (content) =>
    act(() =>
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } }),
    );
  return { state, editor, button, click, edit };
}

test('save previews exact captured draft, freezes editing, backs up by default and retains conflict/disconnect drafts', async (t) => {
  const { state, editor, button, click, edit } = await editorFixture(t);
  assert.equal(button('预览并保存').disabled, true);
  await edit('updated\r\nsecond');
  await click('预览并保存');
  assert.equal(state.saves.length, 0);
  assert.equal(editor.state.readOnly, true);
  const preview = EditorView.findFromDOM(document.querySelector('.remote-text-diff .cm-editor'));
  assert.equal(preview.state.readOnly, true);
  assert.equal(preview.state.sliceDoc(), 'updated\r\nsecond');
  assert.equal(document.querySelector('input[type="checkbox"]').checked, true);
  assert.equal(document.querySelectorAll('.cm-merge-revert').length, 0);
  await click('返回编辑');
  assert.equal(editor.state.readOnly, false);
  assert.equal(editor.state.sliceDoc(), 'updated\r\nsecond');
  await edit('latest\r\nsecond');
  await click('预览并保存');
  await click('确认保存');
  assert.equal(state.saves.length, 1);
  assert.equal(state.saves[0].content, 'latest\r\nsecond');
  assert.equal(state.saves[0].backup, true);
  assert.match(document.body.textContent, /保存冲突/);
  assert.equal(editor.state.sliceDoc(), 'latest\r\nsecond');
  await click('返回编辑');
  await click('预览并保存');
  await act(() => document.querySelector('input[type="checkbox"]').click());
  await click('确认保存');
  assert.equal(state.saves[1].backup, false);
  await act(async () => {
    document.querySelector('.dialog-close').click();
    await tick();
  });
  assert.equal(state.confirmations, 1);
  assert.ok(document.querySelector('dialog').open);
  state.connected = false;
  await click('确认保存');
  assert.equal(state.saves.length, 2);
  assert.match(document.body.textContent, /连接已断开/);
  await click('返回编辑');
  assert.equal(editor.state.sliceDoc(), 'latest\r\nsecond');
});

test('history cancel preserves draft; restoring adopts only historical bytes/codec and current remote revision', async (t) => {
  const { state, editor, button, click, edit } = await editorFixture(t);
  await edit('unsaved\r\ndraft');
  state.current = { ...state.current, content: 'remote\r\nchanged', revision: 'current-remote' };
  await click('历史版本');
  await act(async () => {
    document.querySelector('.remote-text-history-row button').click();
    await tick();
  });
  const preview = EditorView.findFromDOM(document.querySelector('.remote-text-diff .cm-editor'));
  assert.equal(preview.state.sliceDoc(), 'history\r\nsecond');
  await click('载入编辑');
  assert.equal(state.confirmations, 1);
  assert.equal(editor.state.sliceDoc(), 'unsaved\r\ndraft');
  await click('返回编辑');
  assert.equal(editor.state.sliceDoc(), 'unsaved\r\ndraft');
  await click('历史版本');
  await act(async () => {
    document.querySelector('.remote-text-history-row button').click();
    await tick();
  });
  state.accept = true;
  await click('载入编辑');
  assert.equal(editor.state.sliceDoc(), 'history\r\nsecond');
  assert.equal(button('预览并保存').disabled, false);
  await click('预览并保存');
  await click('确认保存');
  assert.equal(state.saves[0].revision, 'current-remote');
  assert.equal(state.saves[0].encoding, 'utf16le');
  assert.equal(state.saves[0].bom, true);
  assert.equal(state.saves[0].backup, true);
  assert.match(document.body.textContent, /保存冲突/);
  assert.equal(editor.state.sliceDoc(), 'history\r\nsecond');
});

test('codec-only restore is dirty; deleting checkpoints does not write remote file', async (t) => {
  const { state, editor, button, click } = await editorFixture(t);
  state.historical = { ...state.historical, content: state.current.content };
  await click('历史版本');
  await act(async () => {
    document.querySelector('.remote-text-history-row button').click();
    await tick();
  });
  await click('载入编辑');
  assert.equal(editor.state.sliceDoc(), state.current.content);
  assert.equal(button('预览并保存').disabled, false);
  await click('历史版本');
  state.accept = true;
  await click('删除');
  assert.deepEqual(state.deleted, ['v1']);
  assert.equal(state.saves.length, 0);
  assert.match(document.body.textContent, /暂无历史版本/);
  await click('返回编辑');
  assert.equal(editor.state.sliceDoc(), state.current.content);
  assert.equal(button('预览并保存').disabled, false);
});
