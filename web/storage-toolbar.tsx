import React, { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Keep storage actions in the workspace header without copying their state. */
export const StorageToolbarTarget = createContext<HTMLElement | null>(null);
export function StorageToolbar({ children }: { children: React.ReactNode }) {
  const target = useContext(StorageToolbarTarget);
  return target ? (
    createPortal(children, target)
  ) : (
    <div className="storage-inline-toolbar toolbar task-toolbar">{children}</div>
  );
}
