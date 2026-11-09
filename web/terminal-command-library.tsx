import { CloseIcon } from './dialog-controls.js';
import { useState, useEffect, useRef } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import Input from '@douyinfe/semi-ui/lib/es/input';
import { SwitchControl as Switch } from './ui/switch-control.js';
import { NativeSelect } from './native-select.js';
import { AiIconButton } from './terminal-ai-icons.js';
import { getPreferences, savePreferences } from './preferences.js';
import {
  errorMessage,
  type ApiClient,
  type Toast,
  type ConfirmAction,
} from './contracts/shared.js';
import { CommandEditor } from './terminal-command-editor.js';
import { useCommandMenu } from './terminal-command-menu.js';
import {
  CommandLabel,
  filterCommandCatalog,
  getCommandCatalog,
  loadCommandCatalog,
  subscribeCommandCatalog,
} from './command-library.js';
import type { CommandEntry } from './contracts/commands.js';
export function TerminalCommandLibrary({
  api,
  toast,
  insert,
  confirm,
  open,
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  insert: (command: string) => void;
  confirm: ConfirmAction;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [catalog, setCatalog] = useState(getCommandCatalog),
    [editing, setEditing] = useState<CommandEntry | null | undefined>(),
    [settingsOpen, setSettingsOpen] = useState(false),
    [checked, setChecked] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    const unsubscribe = subscribeCommandCatalog(() => setCatalog(getCommandCatalog()));
    return () => {
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (open) void loadCommandCatalog(api).catch((e) => toast(errorMessage(e)));
  }, [api, open]);
  const reload = async () => {
    await loadCommandCatalog(api, true);
  };
  const menu = useCommandMenu({
    edit: (entry) => setEditing(entry),
    remove: async (entry) => {
      try {
        await confirm({
          title: '删除命令？',
          text: entry.command,
          danger: true,
          accept: '删除',
          onAccept: async () => {
            await api('/terminal/command-catalog/' + encodeURIComponent(entry.id), 'DELETE');
            await reload();
          },
        });
      } catch (e) {
        toast(errorMessage(e));
      }
    },
  });
  const items = filterCommandCatalog(catalog, query, category);
  async function save() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await savePreferences(api, { commandHints: checked });
      if (mounted.current) {
        setSettingsOpen(false);
        toast('设置已保存');
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <>
      <aside id="terminal-library" className="terminal-assets" hidden={!open}>
        <>
          <div className="terminal-assets-header">
            <strong>常用命令</strong>
            <AiIconButton
              label="命令提示设置"
              icon="settings"
              onClick={() => {
                setChecked(getPreferences().commandHints);
                setError('');

                setSettingsOpen(true);
              }}
            />
            <AiIconButton label="新增命令" icon="new" onClick={() => setEditing(null)} />
            <button type="button" aria-label="收起常用命令" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div className="terminal-command-filters">
            <div className="task-form-control">
              <Input
                aria-label="搜索命令、参数或说明"
                placeholder="搜索命令、参数或说明"
                showClear
                value={query}
                prefix={
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="m16 16 4 4" />
                  </svg>
                }
                onChange={(value: unknown) => {
                  setQuery(String(value ?? ''));
                }}
              />
            </div>
            <div className="task-form-control">
              <NativeSelect
                aria-label="命令分类"
                style={{ width: '100%' }}
                value={category}
                optionList={[
                  { value: '', label: '全部分类' },
                  ...[...new Set(catalog.map((e) => e.category))].map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
                onChange={(value: unknown) => {
                  setCategory(String(value ?? ''));
                }}
              />
            </div>
          </div>
          <div className="terminal-tree terminal-command-options" onScroll={() => menu.close()}>
            {!items.length ? (
              <p className="help">暂无匹配的命令</p>
            ) : (
              items.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-command={entry.command}
                  title={entry.command + '：' + entry.description}
                  {...menu.handlers(entry)}
                  onClick={() => {
                    if (!menu.suppressClick) insert(entry.command);
                  }}
                >
                  <CommandLabel entry={entry} />
                </button>
              ))
            )}
          </div>
        </>
      </aside>
      {menu.content}
      {editing !== undefined && (
        <CommandEditor
          api={api}
          toast={toast}
          entry={editing}
          onSave={reload}
          onClose={() => setEditing(undefined)}
        />
      )}
      <ReactDialog
        open={settingsOpen}
        title="命令提示设置"
        onClose={() => setSettingsOpen(false)}
        busy={saving}
        className="terminal-dialog"
        footer={null}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="task-form-body">
            <div className="terminal-command-setting">
              <label id="command-hints-label">启用命令提示</label>
              <Switch
                checked={checked}
                disabled={saving}
                aria-labelledby="command-hints-label"
                onChange={(value) => setChecked(value === true)}
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button type="button" disabled={saving} onClick={() => setSettingsOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={saving}>
              保存
            </button>
          </div>
        </form>
      </ReactDialog>
    </>
  );
}
