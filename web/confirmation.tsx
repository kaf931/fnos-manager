import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ConfirmAction, type ConfirmOptions } from './contracts/shared.js';
interface Request {
  id: number;
  owner: symbol;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
  busy: boolean;
}
let requests: Request[] = [];
let serial = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => requests;
const emit = () => {
  requests = [...requests];
  listeners.forEach((fn) => fn());
};
function finish(request: Request, result: boolean) {
  requests = requests.filter((r) => r !== request);
  request.resolve(result);
  emit();
}
export function createConfirmation(): ConfirmAction {
  const owner = Symbol();
  const confirm: ConfirmAction = (options = {}) =>
    new Promise((resolve) => {
      requests.push({ id: ++serial, owner, options, resolve, busy: false });
      emit();
    });
  confirm.cancel = () => {
    for (const request of requests.filter((r) => r.owner === owner && !r.busy))
      finish(request, false);
  };
  return confirm;
}
export const confirmAction = createConfirmation();
function Confirmation({ request }: { request: Request }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const {
    title = '确认操作',
    text = '',
    details = '',
    accept = '确认',
    cancel = '取消',
    danger,
    onAccept,
  } = request.options;
  async function acceptAction() {
    if (request.busy) return;
    request.busy = true;
    setBusy(true);
    setError('');
    try {
      await onAccept?.();
      finish(request, true);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      request.busy = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ReactDialog
      size="small"
      open
      onClose={() => {
        if (!request.busy) finish(request, false);
      }}
      title={title}
      busy={busy}
      className="confirmation-dialog"
      footer={
        <>
          <button type="button" data-cancel disabled={busy} onClick={() => finish(request, false)}>
            {cancel}
          </button>
          <button
            type="button"
            data-accept
            disabled={busy}
            className={danger ? 'danger' : 'primary'}
            onClick={() => void acceptAction()}
          >
            {accept}
          </button>
        </>
      }
    >
      <div className="task-form-body">
        <p data-message>{text}</p>
        {details && (
          <pre className="terminal-fingerprint" data-details>
            {details}
          </pre>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ReactDialog>
  );
}
export function ConfirmationHost() {
  const pending = useSyncExternalStore(subscribe, snapshot, snapshot);
  return pending[0] ? <Confirmation key={pending[0].id} request={pending[0]} /> : null;
}
