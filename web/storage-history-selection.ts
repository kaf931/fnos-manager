export const HISTORY_SELECTION_LIMIT = 200;
export function selectHistoryRecords(
  selected: readonly string[],
  { add = [], remove = [] }: { add?: readonly string[]; remove?: readonly string[] },
) {
  const removed = new Set(remove);
  const ids = [...new Set(selected)].filter((id) => !removed.has(id));
  let limited = ids.length > HISTORY_SELECTION_LIMIT;
  ids.length = Math.min(ids.length, HISTORY_SELECTION_LIMIT);
  const included = new Set(ids);
  for (const id of add) {
    if (included.has(id)) continue;
    if (ids.length >= HISTORY_SELECTION_LIMIT) {
      limited = true;
      continue;
    }
    included.add(id);
    ids.push(id);
  }
  return { ids, limited };
}
