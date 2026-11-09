import type { ReactNode } from 'react';
import { icon } from './terminal-file-icons.js';

/** Path navigation and listing summary shared by SSH and ADB file panels. */
export function FileToolbar({
  draft,
  onDraft,
  onGo,
  onBack,
  onForward,
  onRefresh,
  canBack,
  canForward,
  loading,
  connected,
  summary,
  children,
  beforeRefresh,
  pathLabel = '文件路径',
}: {
  draft: string;
  onDraft: (value: string) => void;
  onGo: () => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  connected: boolean;
  summary: string;
  children?: ReactNode;
  beforeRefresh?: ReactNode;
  pathLabel?: string;
}) {
  const button = (label: string, glyph: string, action: () => void, disabled: boolean) => (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={action}
      disabled={disabled}
    >
      {icon(glyph)}
    </button>
  );
  return (
    <>
      <form
        className="terminal-files-path"
        onSubmit={(event) => {
          event.preventDefault();
          onGo();
        }}
      >
        {button('后退', 'back', onBack, loading || !connected || !canBack)}
        {button('前进', 'forward', onForward, loading || !connected || !canForward)}
        <input
          aria-label={pathLabel}
          value={draft}
          placeholder="输入绝对路径"
          onChange={(event) => onDraft(event.target.value)}
          disabled={!connected}
        />
        {beforeRefresh}
        {button('刷新目录', 'refresh', onRefresh, loading || !connected)}
      </form>
      <div className="terminal-files-tools">
        <span>{summary}</span>
        {children}
      </div>
    </>
  );
}
