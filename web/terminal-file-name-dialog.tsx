import { useState } from 'react';
import { requestRemoteDialog } from './features/terminal/dialogs.js';
import { ReactDialog } from './ui/react-dialog.js';
import { validName } from './terminal-file-model.js';
export function askName(title: string, initial = ''): Promise<string | null> {
  return requestRemoteDialog<string>((finish) => (
    <NameDialog title={title} initial={initial} finish={finish} />
  ));
}
function NameDialog({
  title,
  initial,
  finish,
}: {
  title: string;
  initial: string;
  finish: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState('');
  return (
    <ReactDialog
      size="small"
      open
      title={title}
      onClose={() => finish(null)}
      className="terminal-dialog file-name-dialog"
      footer={null}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!validName(value)) setError('请输入有效名称，不含路径分隔符或控制字符');
          else finish(value);
        }}
      >
        <div className="task-form-body">
          <label htmlFor="terminal-file-name">名称</label>
          <input
            id="terminal-file-name"
            required
            maxLength={255}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={() => finish(null)}>
            取消
          </button>
          <button type="submit" className="primary">
            确定
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
