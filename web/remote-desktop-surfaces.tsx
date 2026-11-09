import { LoadingIndicator } from './loading-indicator.js';

/** Shared feedback and input surfaces for both remote desktop protocols. */
export function RemoteDesktopStatus({ status, failure }: { status: string; failure: boolean }) {
  if (!status) return null;
  const pending = status === '正在连接…' || status === '准备连接…';
  return (
    <div
      className={'remote-desktop-status' + (failure ? ' error' : '')}
      role={failure ? 'alert' : 'status'}
    >
      {pending && <LoadingIndicator />}
      <span>{status}</span>
    </div>
  );
}

export function RemoteDesktopTextInput({
  value,
  connected,
  onChange,
  onSend,
}: {
  value: string;
  connected: boolean;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
}) {
  return (
    <form
      className="remote-desktop-input form-input-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!connected) return;
        onSend(value + '\n');
        onChange('');
      }}
    >
      <input
        className="form-input"
        aria-label="发送文字到远程桌面"
        placeholder="输入文字"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button disabled={!connected}>发送</button>
    </form>
  );
}
