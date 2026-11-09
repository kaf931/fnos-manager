import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { CommandEntry, ShellContext } from './contracts/commands.js';
import {
  CommandLabel,
  getCommandCatalog,
  loadCommandCatalog,
  subscribeCommandCatalog,
} from './command-library.js';
import { getPreferences, subscribePreferences } from './preferences.js';
import { shellCommandContext, commandSuggestions } from './terminal-command-catalog.js';
import type { ApiClient } from './contracts/shared.js';
export function TerminalSuggestions({
  terminal,
  host,
  enabled,
  api,
  send,
  register,
}: {
  terminal: Terminal | null;
  host: React.RefObject<HTMLDivElement>;
  enabled: boolean;
  api: ApiClient;
  send: (data: string) => void;
  register: (handler: { input: (data: string) => void; reset: () => void }) => void;
}) {
  const [context, setContext] = useState<ShellContext | null>(null),
    [entries, setEntries] = useState<CommandEntry[]>(getCommandCatalog);
  const expected = useRef<ShellContext | null>(null),
    popup = useRef<HTMLElement>(null);
  const reset = () => {
    expected.current = null;
    setContext(null);
  };
  useEffect(() => {
    void loadCommandCatalog(api).catch(() => {});
    const unsubscribe = subscribeCommandCatalog(() => setEntries(getCommandCatalog()));
    return () => {
      unsubscribe();
    };
  }, [api]);
  useEffect(() => subscribePreferences(reset), []);
  useEffect(() => {
    if (!terminal) return;
    const refresh = () => {
      const next = shellCommandContext(terminal),
        previous = expected.current;
      if (
        !enabled ||
        !getPreferences().commandHints ||
        !next ||
        !previous ||
        next.row !== previous.row ||
        next.prompt !== previous.prompt ||
        next.input !== previous.input
      )
        setContext(null);
      else setContext(next);
    };
    register({
      reset,
      input(data) {
        setContext(null);
        if (
          !enabled ||
          !getPreferences().commandHints ||
          !(/^[\x20-\x7e]{1,200}$/.test(data) || data === '\x7f' || data === '\b')
        )
          return reset();
        const previous = expected.current || shellCommandContext(terminal);
        if (!previous) return reset();
        const input =
          data === '\x7f' || data === '\b' ? previous.input.slice(0, -1) : previous.input + data;
        if (input.length > 200) return reset();
        expected.current = { ...previous, input };
      },
    });
    const subscriptions = [
      terminal.onWriteParsed(refresh),
      terminal.onResize(refresh),
      terminal.onScroll(reset),
    ];
    return () => {
      subscriptions.forEach((s) => s.dispose());
      register({ input: () => {}, reset: () => {} });
    };
  }, [terminal, enabled]);
  const candidates = context ? commandSuggestions(context.input, entries) : [];
  useLayoutEffect(() => {
    if (!terminal || !host.current || !popup.current) return;
    const container = host.current,
      node = popup.current,
      screen = container.querySelector('.xterm-screen')?.getBoundingClientRect(),
      base = container.getBoundingClientRect();
    const width = Math.min(360, container.clientWidth - 16),
      height = Math.min(320, container.clientHeight - 16);
    const cellWidth = (screen?.width || container.clientWidth) / terminal.cols,
      cellHeight = (screen?.height || container.clientHeight) / terminal.rows;
    const x =
      (screen ? screen.left - base.left : 0) + terminal.buffer.active.cursorX * cellWidth + 8;
    node.style.width = width + 'px';
    node.style.maxHeight = height + 'px';
    node.style.left = Math.max(8, Math.min(x, container.clientWidth - width - 8)) + 'px';
    const y = (screen ? screen.top - base.top : 0) + terminal.buffer.active.cursorY * cellHeight;
    node.style.top =
      Math.max(
        8,
        Math.min(
          x + width <= container.clientWidth - 8 ? y : y + cellHeight + 4,
          container.clientHeight - (node.getBoundingClientRect().height || height) - 8,
        ),
      ) + 'px';
  }, [context, candidates.length, terminal]);
  if (!enabled || !context || !candidates.length) return null;
  return (
    <section
      ref={popup}
      className="terminal-command-suggestions"
      aria-label="命令提示"
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className="terminal-command-heading">
        <span>命令提示</span>
        <button aria-label="关闭命令提示" onClick={reset}>
          ×
        </button>
      </div>
      <div className="terminal-command-options">
        {candidates.map((candidate) => (
          <button
            key={candidate.id + candidate.command}
            data-command={candidate.command}
            onClick={() => {
              if (!terminal) return;
              const current = shellCommandContext(terminal);
              if (
                !current ||
                current.row !== context.row ||
                current.prompt !== context.prompt ||
                current.input !== context.input
              )
                return reset();
              const suffix = candidate.command.slice(current.input.length);
              reset();
              if (suffix && !/[\r\n\x00-\x1f\x7f]/.test(suffix)) send(suffix);
              terminal.focus();
            }}
          >
            <CommandLabel entry={candidate} />
          </button>
        ))}
      </div>
    </section>
  );
}
