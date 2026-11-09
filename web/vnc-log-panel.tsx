import React, { useRef, useLayoutEffect } from 'react';
import { AppIcon } from './ui/icon-markup.js';
import { vncStageLabels, type VncLogRow } from './vnc-log-model.js';
export function VncLogPanel({
  items,
  onCopy,
  onClear,
  onClose,
}: {
  items: VncLogRow[];
  onCopy: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const list = useRef<HTMLDivElement>(null),
    stickToEnd = useRef(true);
  useLayoutEffect(() => {
    if (!items.length) stickToEnd.current = true;
    if (list.current && stickToEnd.current) list.current.scrollTop = list.current.scrollHeight;
  }, [items.at(-1)?.key, items.length]);
  return (
    <>
      <div className="terminal-assets-header">
        <strong>连接日志</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="复制连接日志"
          title="复制连接日志"
          disabled={!items.length}
          onClick={onCopy}
        >
          <AppIcon name="clipboard" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="清空连接日志"
          title="清空连接日志"
          disabled={!items.length}
          onClick={onClear}
        >
          <AppIcon name="trash" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="收起连接日志"
          title="收起连接日志"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        ref={list}
        className="vnc-log-list"
        role="region"
        aria-label="连接诊断记录"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {!items.length ? (
          <p className="help">暂无连接日志</p>
        ) : (
          <ol>
            {items.map((item) => (
              <li key={item.key} className={'vnc-log-entry ' + item.level}>
                <div className="vnc-log-meta">
                  <time dateTime={item.time}>
                    {new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false })}
                  </time>
                  <span>
                    {vncStageLabels[item.stage]} · {item.source}
                  </span>
                  <span>+{(item.elapsedMs / 1000).toFixed(1)}s</span>
                </div>
                <p>{item.message}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
