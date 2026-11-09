import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
type Request = { id: number; content: ReactNode; cancel: () => void };
let requests: Request[] = [],
  serial = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function requestRemoteDialog<T>(
  render: (finish: (result: T | null) => void) => ReactNode,
): Promise<T | null> {
  return new Promise((resolve) => {
    const id = ++serial;
    const finish = (result: T | null) => {
      requests = requests.filter((r) => r.id !== id);
      emit();
      resolve(result);
    };
    requests = [...requests, { id, content: render(finish), cancel: () => finish(null) }];
    emit();
  });
}
export function RemoteDialogHost() {
  const current = useSyncExternalStore(subscribe, () => requests);
  useEffect(
    () => () => {
      for (const request of [...requests]) request.cancel();
    },
    [],
  );
  return (
    <>
      {current.map((request) => (
        <RemoteDialogEntry key={request.id}>{request.content}</RemoteDialogEntry>
      ))}
    </>
  );
}
function RemoteDialogEntry({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
