import {
  canRetryUpload,
  retryUpload,
  cancelPendingUpload,
  mergePendingUploads,
} from './terminal-transfer-retry.js';
import React, { useState, useRef, useEffect } from 'react';
import type { ApiClient } from './contracts/shared.js';
import type { SessionIdentity } from './contracts/terminal.js';
import type { TransferRecord } from '../backend/domain/transfers.js';
const statuses = {
  queued: '排队中',
  running: '正在传输',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};
const size = (bytes: number) => {
  let n = bytes,
    i = 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 1 : 0) + ' ' + units[i];
};
export function TerminalTransfers({
  api,
  target,
  open,
  onClose,
  onCount,
}: {
  api: ApiClient;
  target: SessionIdentity | null;
  open: boolean;
  onClose: () => void;
  onCount: (count: number) => void;
}) {
  const sessionId = target?.id || '';
  const [items, setItems] = useState<TransferRecord[]>([]),
    [readError, setReadError] = useState(''),
    [actionError, setActionError] = useState(''),
    [actions, setActions] = useState(new Set<string>());
  const generation = useRef(0),
    refreshRef = useRef(() => {}),
    countRef = useRef(onCount);
  countRef.current = onCount;
  useEffect(() => {
    const ticket = ++generation.current;
    let pending = false;
    setItems([]);
    setReadError('');
    setActionError('');
    countRef.current(0);
    async function refresh() {
      if (!sessionId || pending || document.hidden) return;
      pending = true;
      try {
        const data = await api<{ active: number; items: TransferRecord[] }>(
          '/terminal/transfers?' + new URLSearchParams({ sessionId }),
        );
        if (ticket !== generation.current) return;
        setReadError('');
        const merged = mergePendingUploads(sessionId, data.items);
        setItems(merged);
        countRef.current(
          merged.filter((item) => ['queued', 'running'].includes(item.status)).length,
        );
      } catch {
        if (ticket === generation.current) setReadError('暂时无法读取传输记录');
      } finally {
        pending = false;
      }
    }
    refreshRef.current = () => void refresh();
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    document.addEventListener('visibilitychange', refreshRef.current);
    const listener = refreshRef.current;
    return () => {
      generation.current++;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', listener);
    };
  }, [api, sessionId]);
  async function act(item: TransferRecord, action: 'cancel' | 'retry') {
    if (actions.has(item.id)) return;
    const ticket = generation.current;
    setActions((previous) => new Set([...previous, item.id]));
    setActionError('');
    try {
      if (action === 'cancel') {
        if (item.id.startsWith('local:')) {
          if (!cancelPendingUpload(sessionId, item.clientId)) throw Error('传输已结束');
        } else
          await api(
            '/terminal/sessions/' +
              encodeURIComponent(sessionId) +
              '/transfers/' +
              encodeURIComponent(item.id) +
              '/cancel',
            'POST',
          );
      } else if (item.direction === 'upload' && item.clientId)
        await retryUpload(sessionId, item.clientId);
      else {
        const link = document.createElement('a');
        link.href =
          '/app/deskicons/api/terminal/sessions/' +
          encodeURIComponent(sessionId) +
          '/files/download?' +
          new URLSearchParams({ path: item.path });
        link.download = '';
        link.target = '_blank';
        link.rel = 'noopener';
        link.click();
      }
    } catch (error) {
      if (ticket === generation.current)
        setActionError(error instanceof Error ? error.message : '传输操作失败');
    } finally {
      setActions((previous) => {
        const next = new Set(previous);
        next.delete(item.id);
        return next;
      });
      if (ticket === generation.current) refreshRef.current();
    }
  }
  return (
    <aside id="terminal-transfers" className="terminal-assets terminal-transfers" hidden={!open}>
      <div className="terminal-assets-header">
        <strong>文件传输</strong>
        <button aria-label="收起文件传输" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="terminal-tree">
        <>
          {readError && (
            <p className="notice error" role="alert">
              {readError}
            </p>
          )}
          {actionError && (
            <p className="notice error" role="alert">
              {actionError}
            </p>
          )}
          {items.length ? (
            items.map((item) => {
              const name = item.path.split('/').pop() || item.path,
                direction = item.direction === 'upload' ? '上传' : '下载';
              const progress = item.size
                ? Math.min(99, Math.floor((item.transferred / item.size) * 100))
                : 0;
              const text =
                item.status === 'queued'
                  ? '排队'
                  : item.status === 'running'
                    ? progress + '%'
                    : item.status === 'completed'
                      ? '✓'
                      : item.status === 'failed'
                        ? '×'
                        : '—';
              return (
                <div className="terminal-tree-row" key={item.id}>
                  <span className="terminal-tree-symbol" title={direction} aria-label={direction}>
                    {item.direction === 'upload' ? '↑' : '↓'}
                  </span>
                  <span className="terminal-tree-name" title={item.path}>
                    {name}
                  </span>
                  <span className="help transfer-size">{size(item.size)}</span>
                  <span
                    className={
                      'transfer-result ' + (item.status === 'completed' ? 'success' : item.status)
                    }
                    title={statuses[item.status]}
                    aria-label={statuses[item.status]}
                  >
                    {text}
                  </span>
                  <span className="terminal-transfer-actions">
                    {['queued', 'running'].includes(item.status) && (
                      <button
                        type="button"
                        disabled={actions.has(item.id)}
                        onClick={() => void act(item, 'cancel')}
                      >
                        取消
                      </button>
                    )}
                    {['failed', 'cancelled'].includes(item.status) &&
                      (item.direction === 'download' ||
                        canRetryUpload(sessionId, item.clientId)) && (
                        <button
                          type="button"
                          disabled={actions.has(item.id)}
                          onClick={() => void act(item, 'retry')}
                        >
                          重试
                        </button>
                      )}
                    {item.status === 'failed' &&
                      item.direction === 'upload' &&
                      !canRetryUpload(sessionId, item.clientId) && (
                        <span className="help" title="浏览器已释放原文件，请重新选择上传">
                          需重选文件
                        </span>
                      )}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="help">暂无文件传输记录</p>
          )}
        </>
      </div>
    </aside>
  );
}
