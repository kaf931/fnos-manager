/** Suppress tagged reasoning across arbitrary streaming fragment boundaries. */
export function createVisibleAiText(emit: (text: string) => void) {
  let pending = '',
    hidden = false;
  function push(text: string, final = false) {
    pending += text;
    while (pending) {
      const tag = hidden ? '</think>' : '<think>',
        index = pending.toLowerCase().indexOf(tag);
      if (index >= 0) {
        if (!hidden && index) emit(pending.slice(0, index));
        pending = pending.slice(index + tag.length);
        hidden = !hidden;
        continue;
      }
      let keep = 0;
      if (!final)
        for (let i = 1; i < tag.length && i <= pending.length; i++)
          if (tag.startsWith(pending.slice(-i).toLowerCase())) keep = i;
      const visible = pending.slice(0, pending.length - keep);
      if (!hidden && visible) emit(visible);
      pending = keep ? pending.slice(-keep) : '';
      break;
    }
  }
  return { push: (text: string) => push(text), finish: () => push('', true) };
}
