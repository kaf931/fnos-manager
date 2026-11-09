import type { AiTarget, AiCapture, AiSnapshot } from './contracts/ai.js';
export function createAiViewModel() {
  let target: AiTarget | null = null,
    key = '',
    epoch = 0,
    busy = false;
  return {
    invalidate() {
      epoch++;
      busy = false;
    },
    select(next: AiTarget | null) {
      const nextKey = next?.id ? `${next.id}:${next.generation}:${!!next.connected}` : '';
      const previous = target;
      const changed = key !== nextKey;
      target = next ? { ...next } : null;
      if (changed) {
        epoch++;
        key = nextKey;
        busy = false;
      }
      return { changed, previous };
    },
    capture() {
      return { key, epoch, sessionId: target?.id || '', connected: !!target?.connected };
    },
    isCurrent(snapshot: AiCapture) {
      return snapshot.key === key && snapshot.epoch === epoch;
    },
    beginAction(snapshot: AiCapture) {
      if (snapshot.key !== key || snapshot.epoch !== epoch || !snapshot.connected || busy)
        return false;
      busy = true;
      return true;
    },
    finishAction(snapshot: AiCapture) {
      if (snapshot.key !== key || snapshot.epoch !== epoch) return false;
      busy = false;
      return true;
    },
    get busy() {
      return busy;
    },
  };
}

export function aiActivity(snapshot: AiSnapshot | null, submitting = false) {
  if (snapshot?.error || !(snapshot?.busy || submitting)) return '';
  if (snapshot?.proposals?.some((p) => p.status === 'running')) return '正在执行命令…';
  const last = snapshot?.messages?.at(-1);
  return last?.role === 'assistant' && last.content.trim() ? '' : '正在思考…';
}
