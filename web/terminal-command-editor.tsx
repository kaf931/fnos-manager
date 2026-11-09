import { useEffect, useRef, useState } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type { CommandEntry } from './contracts/commands.js';
export function CommandEditor({
  api,
  toast,
  entry: initial,
  onSave,
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  entry: CommandEntry | null;
  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState({
      command: initial?.command || '',
      description: initial?.description || '',
      category: initial?.category || '自定义',
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  async function save() {
    if (busy) return;
    if (/[\x00-\x1f\x7f]/.test(entry.command)) return setError('命令只能包含单行文本');
    setBusy(true);
    setError('');
    try {
      await api(
        '/terminal/command-catalog' + (initial ? '/' + encodeURIComponent(initial.id) : ''),
        initial ? 'PUT' : 'POST',
        entry,
      );
      if (!mounted.current) return;
      try {
        await onSave();
      } catch {
        if (mounted.current) {
          toast('命令已保存，列表刷新失败，请重新打开常用命令');
          onClose();
        }
        return;
      }
      if (mounted.current) {
        toast('命令已保存');
        onClose();
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      open
      title={initial ? '编辑命令' : '新增命令'}
      className="terminal-dialog"
      busy={busy}
      onClose={onClose}
      footer={null}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="task-form-body">
          {(['command', 'description', 'category'] as const).map((name, index) => (
            <label key={name}>
              {['命令', '中文说明', '分类'][index]}
              <input
                required
                maxLength={name === 'category' ? 40 : 300}
                value={entry[name]}
                onChange={(e) => setEntry({ ...entry, [name]: e.target.value })}
              />
            </label>
          ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
