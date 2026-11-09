export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface ApiClient {
  <T = unknown>(
    path: string,
    method?: HttpMethod,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T>;
}
export type Toast = (message: string) => void;
export interface ConfirmOptions {
  title?: string;
  text?: string;
  details?: string;
  danger?: boolean;
  accept?: string;
  cancel?: string;
  onAccept?: () => void | Promise<void>;
}
export interface ConfirmAction {
  (options?: ConfirmOptions): Promise<boolean>;
  cancel?: () => void;
}
export type IconMarkup = (name: string) => string;
export interface AppState {
  native: boolean;
  gateway: boolean;
  csrfToken: string;
  version: string;
  hostname: string;
}
export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return fallback;
}
