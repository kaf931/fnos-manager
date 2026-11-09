import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { requestRemoteDialog } from './features/terminal/dialogs.js';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { NativeSelect } from './native-select.js';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ConfirmAction, type Toast } from './contracts/shared.js';
import type { SessionIdentity, RemoteTextFile, TextFileVersion } from './contracts/terminal.js';
import type { createFileApi } from './terminal-file-api.js';
import './terminal-text-editor.css';
const encodings = [
  { value: 'auto', label: '自动识别' },
  { value: 'utf8', label: 'UTF-8' },
  { value: 'utf8-bom', label: 'UTF-8 BOM' },
  { value: 'utf16le', label: 'UTF-16 LE' },
  { value: 'utf16be', label: 'UTF-16 BE' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
];
function language(name: string) {
  if (/\.[cm]?[jt]sx?$/i.test(name))
    return javascript({ typescript: /\.[cm]?tsx?$/i.test(name), jsx: /x$/i.test(name) });
  if (/\.json$/i.test(name)) return json();
  if (/\.ya?ml$/i.test(name)) return yaml();
  if (/\.py$/i.test(name)) return python();
  if (/\.md$/i.test(name)) return markdown();
  if (/\.html?$/i.test(name)) return html();
  if (/\.css$/i.test(name)) return css();
  if (/\.(sh|bash|zsh)$|^\.?(bashrc|zshrc|profile)$/i.test(name))
    return StreamLanguage.define(shell);
  return [];
}
interface Options {
  fileApi: ReturnType<typeof createFileApi>;
  session: SessionIdentity;
  path: string;
  name: string;
  valid: (session: SessionIdentity) => boolean;
  confirm: ConfirmAction;
  toast: Toast;
  onSaved: () => void;
}
let active = false;
export function openTextEditor(options: Options) {
  if (active) {
    options.toast('请先关闭当前文件编辑窗口');
    return;
  }
  active = true;
  void requestRemoteDialog<void>((finish) => (
    <TextEditor {...options} finish={() => finish(null)} />
  )).finally(() => {
    active = false;
  });
}

function TextDiff({
  before,
  after,
  name,
}: {
  before: RemoteTextFile;
  after: RemoteTextFile;
  name: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: after.content,
        extensions: [
          basicSetup,
          language(name),
          EditorView.lineWrapping,
          EditorState.lineSeparator.of(after.content.includes('\r\n') ? '\r\n' : '\n'),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ 'aria-label': '只读差异预览' }),
          unifiedMergeView({
            original: before.content,
            mergeControls: false,
            collapseUnchanged: { margin: 3, minSize: 8 },
            diffConfig: { scanLimit: 500, timeout: 100 },
          }),
          EditorView.theme({
            '&': {
              height: '100%',
              backgroundColor: 'var(--semi-color-bg-1)',
              color: 'var(--text)',
            },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace' },
          }),
        ],
      }),
    });
    return () => editor.destroy();
  }, [before, after, name]);
  return <div className="remote-text-content remote-text-diff" ref={host} />;
}
function TextEditor({
  fileApi,
  session,
  path,
  name,
  valid,
  confirm,
  toast,
  onSaved,
  finish,
}: Options & { finish: () => void }) {
  const editorHost = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const original = useRef<RemoteTextFile | null>(null),
    running = useRef(false),
    alive = useRef(true);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false),
    [connected, setConnected] = useState(true),
    [encoding, setEncoding] = useState('auto');
  const [mode, setMode] = useState<'edit' | 'preview' | 'history'>('edit');
  const [preview, setPreview] = useState<RemoteTextFile | null>(null);
  const [backup, setBackup] = useState(true);
  const [versions, setVersions] = useState<TextFileVersion[]>([]);
  const [selected, setSelected] = useState<{
    id: string;
    file: RemoteTextFile;
    current: RemoteTextFile;
  } | null>(null);
  const codec = useRef({ encoding: 'auto', bom: false });
  const lock = useRef(new Compartment());
  const lineEnding = useRef(new Compartment());
  const freeze = (value: boolean) =>
    view.current?.dispatch({
      effects: lock.current.reconfigure([
        EditorState.readOnly.of(value),
        EditorView.editable.of(!value),
      ]),
    });
  const returnToEditing = () => {
    setMode('edit');
    setPreview(null);
    setSelected(null);
    freeze(false);
  };
  const saveAction = useRef<() => void>(() => {});
  const isDirty = () =>
    !!original.current &&
    !!view.current &&
    (view.current.state.sliceDoc() !== original.current.content ||
      codec.current.encoding !== original.current.encoding ||
      codec.current.bom !== original.current.bom);
  const connectedNow = () => valid(session) && session.connected;
  const discard = async () =>
    !isDirty() ||
    (await confirm({ title: '放弃未保存的修改？', text: name, accept: '放弃修改', danger: true }));
  const dismiss = async () => {
    if (!running.current && (await discard()) && alive.current) finish();
  };
  async function load(next = 'auto') {
    if (running.current || !connectedNow()) return;
    if (!(await discard()) || !alive.current || !connectedNow()) return;
    running.current = true;
    freeze(true);
    setBusy(true);
    setError('');
    try {
      const file = await fileApi.readText(session, path, next);
      if (!alive.current || !connectedNow()) return;
      original.current = file;
      setEncoding(file.encoding);
      codec.current = { encoding: file.encoding, bom: file.bom };
      returnToEditing();
      view.current?.destroy();
      view.current = new EditorView({
        parent: editorHost.current!,
        state: EditorState.create({
          doc: file.content,
          extensions: [
            basicSetup,
            lock.current.of([]),
            language(name),
            EditorView.lineWrapping,
            lineEnding.current.of(
              EditorState.lineSeparator.of(file.content.includes('\r\n') ? '\r\n' : '\n'),
            ),
            EditorView.contentAttributes.of({ 'aria-label': '文件内容', spellcheck: 'false' }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) setDirty(isDirty());
            }),
            keymap.of([
              {
                key: 'Mod-s',
                run: () => {
                  saveAction.current();
                  return true;
                },
              },
            ]),
            EditorView.theme({
              '&': {
                height: '100%',
                backgroundColor: 'var(--semi-color-bg-1)',
                color: 'var(--text)',
              },
              '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace' },
              '.cm-gutters': {
                backgroundColor: 'var(--semi-color-fill-0)',
                color: 'var(--muted)',
                border: 'none',
              },
              '&.cm-focused': { outline: 'none' },
              '.cm-content': { padding: '8px 0' },
              '.cm-cursor': { borderLeftColor: 'var(--text)' },
            }),
          ],
        }),
      });
      original.current = { ...file, content: view.current.state.sliceDoc() };
      setDirty(false);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      running.current = false;
      if (alive.current) {
        freeze(false);
        setBusy(false);
      }
    }
  }
  function showPreview() {
    if (running.current || mode !== 'edit' || !original.current || !view.current || !isDirty())
      return;
    if (!connectedNow()) {
      setConnected(false);
      return;
    }
    const draft = { ...original.current, ...codec.current, content: view.current.state.sliceDoc() };
    freeze(true);
    setPreview(draft);
    setBackup(true);
    setError('');
    setMode('preview');
  }
  async function save() {
    if (running.current || !preview || !original.current) return;
    if (!connectedNow()) {
      setConnected(false);
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await fileApi.saveText(session, path, preview, backup);
      if (!alive.current) return;
      original.current = result;
      codec.current = { encoding: result.encoding, bom: result.bom };
      setEncoding(result.encoding);
      returnToEditing();
      setDirty(isDirty());
      toast('文件已保存');
      onSaved();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function history() {
    if (running.current || !connectedNow() || !original.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await fileApi.textVersions(session, path);
      if (!alive.current || !connectedNow()) return;
      setVersions(result.items);
      setSelected(null);
      freeze(true);
      setMode('history');
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function selectVersion(id: string) {
    if (running.current || !connectedNow()) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const [file, current] = await Promise.all([
        fileApi.readTextVersion(session, path, id),
        fileApi.readText(session, path, encoding),
      ]);
      if (alive.current && connectedNow()) setSelected({ id, file, current });
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function restoreDraft() {
    if (
      running.current ||
      !selected ||
      !connectedNow() ||
      !(await discard()) ||
      !alive.current ||
      !connectedNow()
    )
      return;
    // The checkpoint revision belongs to old bytes. Only the current remote revision may authorize a save.
    original.current = selected.current;
    codec.current = { encoding: selected.file.encoding, bom: selected.file.bom };
    setEncoding(selected.file.encoding);
    view.current?.dispatch({
      effects: lineEnding.current.reconfigure(
        EditorState.lineSeparator.of(selected.file.content.includes('\r\n') ? '\r\n' : '\n'),
      ),
    });
    view.current?.dispatch({
      changes: { from: 0, to: view.current.state.doc.length, insert: selected.file.content },
    });
    returnToEditing();
    setDirty(isDirty());
  }
  async function deleteVersion(id: string) {
    if (running.current || !connectedNow()) return;
    if (
      !(await confirm({
        title: '删除此历史版本？',
        text: '只删除本地历史记录，不修改远程文件。',
        accept: '删除版本',
        danger: true,
      })) ||
      !alive.current ||
      !connectedNow()
    )
      return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await fileApi.deleteTextVersion(session, path, id);
      if (alive.current && connectedNow()) {
        setVersions((items) => items.filter((item) => item.id !== id));
        if (selected?.id === id) setSelected(null);
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  saveAction.current = showPreview;
  useLayoutEffect(() => {
    void load();
    return () => {
      alive.current = false;
      view.current?.destroy();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setConnected(connectedNow()), 500);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
  return (
    <ReactDialog
      size="full-width"
      layout="workspace"
      open
      title={
        <span title={path}>
          {name}
          {dirty ? ' · 未保存' : ''}
        </span>
      }
      onClose={() => void dismiss()}
      busy={busy}
      className="remote-text-dialog"
      footer={null}
    >
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!connected && (
        <p className="notice error" role="status">
          连接已断开或切换，请复制保留修改。
        </p>
      )}
      {busy && (
        <p className="notice" role="status">
          {original.current ? '正在处理…' : '正在读取文件…'}
        </p>
      )}
      <div className="remote-text-content" ref={editorHost} hidden={mode !== 'edit'} />
      {mode === 'preview' && preview && original.current && (
        <>
          <p className="notice">
            差异预览 · 编码 {original.current.encoding} → {preview.encoding} · BOM{' '}
            {original.current.bom ? '有' : '无'} → {preview.bom ? '有' : '无'}
          </p>
          <TextDiff before={original.current} after={preview} name={name} />
        </>
      )}
      {mode === 'history' && (
        <>
          <div className="remote-text-history" aria-label="文件历史版本">
            {!versions.length && <p className="help">暂无历史版本</p>}
            {versions.map((item) => (
              <div className="remote-text-history-row" key={item.id}>
                <button
                  disabled={busy || !connected}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => void selectVersion(item.id)}
                >
                  {new Date(item.createdAt).toLocaleString()} · {item.size} 字节 · {item.encoding}
                  {item.bom ? ' · BOM' : ''}
                </button>
                <button disabled={busy || !connected} onClick={() => void deleteVersion(item.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
          {selected && (
            <>
              <p className="notice">载入历史版本后，预览并确认保存。</p>
              <TextDiff before={selected.current} after={selected.file} name={name} />
            </>
          )}
        </>
      )}
      <div className="dialog-footer">
        <div className="remote-text-toolbar">
          <NativeSelect
            aria-label="文件编码"
            value={encoding}
            optionList={encodings}
            disabled={busy || !connected || mode !== 'edit'}
            onChange={(next) => void load(next)}
          />
          <button
            disabled={busy || !connected || mode !== 'edit'}
            onClick={() => void load(encoding)}
          >
            重新读取
          </button>
          <button
            disabled={busy || !connected || !original.current || mode !== 'edit'}
            onClick={() => void history()}
          >
            历史版本
          </button>
          {mode === 'preview' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={backup}
                disabled={busy}
                onChange={(e) => setBackup(e.target.checked)}
              />
              保留修改前版本
            </label>
          )}
        </div>
        {mode !== 'edit' && (
          <button disabled={busy} onClick={returnToEditing}>
            返回编辑
          </button>
        )}
        {mode === 'history' && (
          <button
            className="primary"
            disabled={busy || !connected || !selected}
            onClick={() => void restoreDraft()}
          >
            载入编辑
          </button>
        )}
        <button disabled={busy} onClick={() => void dismiss()}>
          取消
        </button>
        <button
          className="primary"
          hidden={mode === 'history'}
          disabled={busy || !dirty || !connected}
          onClick={() => (mode === 'preview' ? void save() : showPreview())}
        >
          {mode === 'preview' ? '确认保存' : '预览并保存'}
        </button>
      </div>
    </ReactDialog>
  );
}
