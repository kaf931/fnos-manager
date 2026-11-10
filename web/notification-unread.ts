import { useCallback, useSyncExternalStore } from 'react';
import type { ApiClient } from './contracts/shared.js';

// All navigation and message entry points share one poll per API session.
class UnreadStore {
  count = 0;
  listeners = new Set<() => void>();
  timer?: ReturnType<typeof setInterval>;
  request = 0;
  constructor(private api: ApiClient) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), 15000);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        ++this.request;
      }
    };
  };
  async refresh() {
    if (!this.listeners.size) return;
    const request = ++this.request;
    try {
      const result = await this.api<{ count: number }>('/notifications/inbox/unread');
      if (request !== this.request || !this.listeners.size) return;
      this.count = Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : 0;
      for (const listener of this.listeners) listener();
    } catch {
      /* Background failures are shown by the message list when opened. */
    }
  }
}
const stores = new WeakMap<ApiClient, UnreadStore>();
function storeFor(api: ApiClient) {
  let store = stores.get(api);
  if (!store) {
    store = new UnreadStore(api);
    stores.set(api, store);
  }
  return store;
}
export function useNotificationUnread(api: ApiClient, active: boolean) {
  const store = storeFor(api);
  return useSyncExternalStore(
    useCallback((listener) => (active ? store.subscribe(listener) : () => {}), [store, active]),
    () => (active ? store.count : 0),
    () => 0,
  );
}
export function refreshNotificationUnread(api: ApiClient) {
  void storeFor(api).refresh();
}
