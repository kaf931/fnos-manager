import { useEffect, useRef, useState } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type { AiChatSummary } from './contracts/ai.js';
export function AiHistory({
  api,
  toast,
  onRestore,
  canRestore,
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  onRestore: (id: string) => Promise<void>;
  canRestore: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AiChatSummary[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const alive = useRef(true),
    working = useRef(false);
  useEffect(() => {
    void api<AiChatSummary[]>('/terminal/ai/history')
      .then((rows) => {
        if (alive.current) setItems(rows.slice(0, 50));
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [api]);
  const close = () => {
    if (!working.current) onClose();
  };
  async function restore(id: string) {
    if (working.current || !canRestore) return;
    working.current = true;
    setBusy(true);
    try {
      await onRestore(id);
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) toast(errorMessage(e));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      open
      title="AI 历史记录"
      busy={busy}
      onClose={close}
      className="terminal-dialog dialog-scroll-surface"
    >
      <div className="task-form-body">
        <p role="alert" className="form-error" hidden={!error}>
          {error}
        </p>
        {loading && <p role="status">正在读取历史记录…</p>}
        {!items.length
          ? !loading && !error && <p className="help">暂无对话记录</p>
          : items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="terminal-ai-history-entry"
                disabled={busy || !canRestore}
                onClick={() => void restore(item.id)}
              >
                <strong>{item.title}</strong>
                <small className="help">
                  {item.connectionName + ' · ' + new Date(item.updatedAt).toLocaleString('zh-CN')}
                </small>
              </button>
            ))}
      </div>
      <div className="dialog-footer">
        <span />
        <button type="button" onClick={close}>
          关闭
        </button>
      </div>
    </ReactDialog>
  );
}
