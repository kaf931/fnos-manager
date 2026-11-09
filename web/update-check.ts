import { useEffect, useState } from 'react';
import type { ReleaseInfo } from '../backend/updates/releases.js';
import type { ApiClient } from './contracts/shared.js';
/** Quiet background checks: a failed request never interrupts normal use. */
export function startUpdateChecks(
  api: ApiClient,
  receive: (release: ReleaseInfo) => void,
  clock: Pick<Window, 'setTimeout' | 'setInterval' | 'clearTimeout' | 'clearInterval'> = window,
): () => void {
  let alive = true,
    pending = false;
  const check = async () => {
    if (pending) return;
    pending = true;
    try {
      const value = await api<ReleaseInfo>('/updates');
      if (alive) receive(value);
    } catch {
      /* Offline or rate limited: retain the previous successful result. */
    } finally {
      pending = false;
    }
  };
  const initial = clock.setTimeout(() => void check(), 4000);
  const interval = clock.setInterval(() => void check(), 6 * 60 * 60 * 1000);
  return () => {
    alive = false;
    clock.clearTimeout(initial);
    clock.clearInterval(interval);
  };
}
export function useUpdateCheck(api: ApiClient, enabled: boolean): ReleaseInfo | null {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  useEffect(() => {
    if (enabled) return startUpdateChecks(api, setRelease);
  }, [api, enabled]);
  return release;
}

/** Track a discovered update so its sidebar action reflects background download/install progress. */
export function useUpdateActivity(
  api: ApiClient,
  enabled: boolean,
): import('../backend/updates/job.js').UpdateJob | null {
  const [job, setJob] = useState<import('../backend/updates/job.js').UpdateJob | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true,
      pending = false,
      observed = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await api<{ job: import('../backend/updates/job.js').UpdateJob | null }>(
          '/updates/status',
        );
        if (!alive) return;
        setJob(value.job);
        if (
          value.job &&
          !['completed', 'failed', 'rolled-back', 'cancelled'].includes(value.job.phase)
        )
          observed = true;
        if (observed && value.job?.phase === 'completed') {
          observed = false;
          window.location.reload();
        }
      } catch {
        /* Restarts temporarily disconnect the gateway. */
      } finally {
        pending = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [api, enabled]);
  return job;
}
