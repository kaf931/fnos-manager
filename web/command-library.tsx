import type { ApiClient } from './contracts/shared.js';
import type { CommandEntry } from './contracts/commands.js';
let entries: CommandEntry[] = [],
  pending: Promise<CommandEntry[]> | null = null,
  serial = 0;
const listeners = new Set<() => void>();
export const getCommandCatalog = () => entries;
export function subscribeCommandCatalog(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function loadCommandCatalog(api: ApiClient, force = false) {
  if (pending && !force) return pending;
  const ticket = ++serial;
  const request = api<CommandEntry[]>('/terminal/command-catalog')
    .then((value) => {
      if (ticket === serial) {
        entries = value;
        for (const listener of listeners) listener();
      }
      return entries;
    })
    .finally(() => {
      if (ticket === serial) pending = null;
    });
  pending = request;
  return request;
}
export function filterCommandCatalog(catalog: CommandEntry[], query = '', category = '') {
  const text = query.trim().toLocaleLowerCase();
  return catalog.filter(
    (entry) =>
      (!category || entry.category === category) &&
      (!text ||
        `${entry.command} ${entry.description} ${entry.category}`
          .toLocaleLowerCase()
          .includes(text)),
  );
}
export function CommandLabel({ entry }: { entry: Pick<CommandEntry, 'command' | 'description'> }) {
  const index = entry.command.indexOf(' ');
  return (
    <>
      <code>
        <strong>{index < 0 ? entry.command : entry.command.slice(0, index)}</strong>
        <span>{index < 0 ? '' : entry.command.slice(index)}</span>
      </code>
      <span className="command-description">{entry.description}</span>
    </>
  );
}
