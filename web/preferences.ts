import type { UserPreferences } from '../backend/persistence/preferences.repository.js';
import type { ApiClient } from './contracts/shared.js';
let current: UserPreferences = {
  theme: 'system',
  palette: 'classic',
  terminalBackground: 'striped',
  commandHints: true,
  defaultPage: 'icons',
  navigationMotion: true,
};
const listeners = new Set<(value: UserPreferences) => void>();
export const getPreferences = (): UserPreferences => ({ ...current });
function publish(value: Partial<UserPreferences>): UserPreferences {
  current = { ...current, ...value };
  for (const listener of listeners) listener(getPreferences());
  return getPreferences();
}
export async function loadPreferences(api: ApiClient) {
  return publish(await api<UserPreferences>('/preferences'));
}
export async function savePreferences(api: ApiClient, patch: Partial<UserPreferences>) {
  return publish(await api<UserPreferences>('/preferences', 'PUT', patch));
}
export function subscribePreferences(listener: (value: UserPreferences) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
