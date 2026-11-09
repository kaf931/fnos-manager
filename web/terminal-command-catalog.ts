import type { Terminal } from '@xterm/xterm';
import type { CommandEntry } from './contracts/commands.js';
export function commandSuggestions(input: string, entries: CommandEntry[] = []) {
  if (!input || input.length > 200 || !/^[a-zA-Z0-9 ._/-]+$/.test(input)) return [];
  const sudo = input.startsWith('sudo '),
    query = sudo ? input.slice(5) : input;
  if (!query) return [];
  return entries
    .filter(
      (e) =>
        (!sudo || (!e.command.startsWith('sudo ') && !e.command.startsWith('cd '))) &&
        e.command.startsWith(query),
    )
    .map((e) => ({ ...e, command: (sudo ? 'sudo ' : '') + e.command }))
    .filter((e) => e.command !== input)
    .slice(0, 12);
}
export function shellCommandContext(terminal: Terminal) {
  const b = terminal.buffer.active;
  if (b.type !== 'normal' || b.viewportY !== b.baseY) return null;
  const row = b.baseY + b.cursorY,
    line = b.getLine(row);
  if (!line || line.isWrapped || line.translateToString(true, b.cursorX).trim()) return null;
  const text = line.translateToString(false, 0, b.cursorX);
  // Conservative shell-prompt recognition. No raw keystrokes or hidden password text.
  const match = /^(.*(?:[$#%❯>] ))([a-zA-Z0-9 ._/-]*)$/.exec(text);
  if (!match || match[1].length > 240 || match[2].length > 200) return null;
  return { prompt: match[1], input: match[2], row };
}
