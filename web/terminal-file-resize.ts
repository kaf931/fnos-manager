import type React from 'react';
import type { PositionedFileContext } from './contracts/terminal.js';
import { useState, useRef, useEffect } from 'react';
import { clampFilePanelWidth, resolveFilePanelResize } from './terminal-file-model.js';

export function useFilePanelResize({
  workspaceRef,
  clearPress,
  setContext,
  setOpen,
}: {
  workspaceRef: React.RefObject<HTMLDivElement>;
  clearPress: () => void;
  setContext: (value: PositionedFileContext | null) => void;
  setOpen: (value: boolean) => void;
}) {
  const [panelWidth, setPanelWidth] = useState(360),
    [workspaceWidth, setWorkspaceWidth] = useState(() => workspaceRef.current?.clientWidth || 0);
  const resizeDrag = useRef<{ pointerId: number; right: number; initialWidth: number } | null>(
    null,
  );
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setWorkspaceWidth(width);
    });
    observer.observe(workspace);
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('terminal-files-resizing');
    };
  }, []);
  const visiblePanelWidth = clampFilePanelWidth(panelWidth, workspaceWidth),
    panelStyle = { '--terminal-files-width': visiblePanelWidth + 'px' } as React.CSSProperties;
  function startResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || workspaceWidth <= 620) return;
    clearPress();
    setContext(null);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeDrag.current = {
      pointerId: event.pointerId,
      right: workspaceRef.current!.getBoundingClientRect().right,
      initialWidth: visiblePanelWidth,
    };
    document.documentElement.classList.add('terminal-files-resizing');
  }
  function applyResize(width: number, restoreWidth: number) {
    const next = resolveFilePanelResize(width, workspaceWidth);
    if (next.collapsed) {
      setOpen(false);
      setContext(null);
      setPanelWidth(clampFilePanelWidth(restoreWidth || 360, workspaceWidth));
      return true;
    }
    setPanelWidth(next.width);
    return false;
  }
  function moveResize(event: React.PointerEvent<HTMLElement>) {
    const drag = resizeDrag.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (applyResize(drag.right - event.clientX, drag.initialWidth)) stopResize(event);
  }
  function stopResize(event: React.PointerEvent<HTMLElement>) {
    if (resizeDrag.current?.pointerId !== event.pointerId) return;
    resizeDrag.current = null;
    document.documentElement.classList.remove('terminal-files-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboardResize(event: React.KeyboardEvent<HTMLElement>) {
    let next;
    if (event.key === 'ArrowLeft') next = visiblePanelWidth + 20;
    else if (event.key === 'ArrowRight') next = visiblePanelWidth - 20;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = workspaceWidth;
    else return;
    event.preventDefault();
    applyResize(next, visiblePanelWidth);
  }

  return {
    visiblePanelWidth,
    panelStyle,
    resizerProps: {
      'aria-valuenow': Math.round(visiblePanelWidth),
      'aria-valuemin': 0,
      'aria-valuemax': clampFilePanelWidth(workspaceWidth, workspaceWidth),
      onPointerDown: startResize,
      onPointerMove: moveResize,
      onPointerUp: stopResize,
      onPointerCancel: stopResize,
      onLostPointerCapture: () => {
        resizeDrag.current = null;
        document.documentElement.classList.remove('terminal-files-resizing');
      },
      onKeyDown: keyboardResize,
    },
  };
}
