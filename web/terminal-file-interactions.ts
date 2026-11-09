import type {
  FileSessionRefs,
  FileListing,
  FileEntry,
  PositionedFileContext,
  SessionIdentity,
} from './contracts/terminal.js';
export interface FileContextEvent {
  preventDefault: () => void;
  stopPropagation: () => void;
  clientX: number;
  clientY: number;
}
export interface PressState {
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}
import { useRef, useEffect } from 'react';
import { bindFileMenuDismiss } from './terminal-context-dismiss.js';
import { isFileContextCurrent } from './terminal-file-model.js';

export function useFileInteractions({
  session,
  data,
  busy,
  context,
  setContext,
  current,
  directory,
  seq,
}: FileSessionRefs & {
  session: SessionIdentity;
  data: FileListing | null;
  busy: boolean;
  context: PositionedFileContext | null;
  setContext: (value: PositionedFileContext | null) => void;
}) {
  const press = useRef<PressState | null>(null),
    longPress = useRef(false),
    lastPointer = useRef('mouse');
  function clearPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  function showContext(event: FileContextEvent, entry: FileEntry | null) {
    event.preventDefault();
    event.stopPropagation();
    if (!session.connected || !data || busy || !directory.current) return;
    setContext({
      x: event.clientX,
      y: event.clientY,
      entry,
      session: { ...current.current },
      path: directory.current,
      sequence: seq.current,
    });
  }
  function touchStart(event: FileContextEvent & { pointerType: string }, entry: FileEntry | null) {
    lastPointer.current = event.pointerType || 'mouse';
    if (event.pointerType !== 'touch' || !directory.current) return;
    event.stopPropagation();
    clearPress();
    longPress.current = false;
    const { clientX: x, clientY: y } = event,
      snapshot = {
        x,
        y,
        entry,
        session: { ...current.current },
        path: directory.current,
        sequence: seq.current,
      };
    press.current = {
      x,
      y,
      timer: setTimeout(() => {
        if (
          isFileContextCurrent(snapshot, current.current, directory.current, seq.current) &&
          !busy
        ) {
          longPress.current = true;
          setContext(snapshot);
        }
      }, 500),
    };
  }
  useEffect(() => {
    if (context) return bindFileMenuDismiss(document, () => setContext(null));
  }, [context]);
  useEffect(() => () => clearPress(), []);

  return { press, longPress, lastPointer, clearPress, showContext, touchStart };
}
