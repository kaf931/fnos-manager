/** Narrows errors at process, network and filesystem boundaries without trusting arbitrary properties. */
export function errorInfo(error: unknown): { message: string; code?: string; status?: number } {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    message: typeof value.message === 'string' ? value.message : '操作失败',
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.status === 'number' ? { status: value.status } : {}),
  };
}
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
export function inputRecord(
  value: unknown,
  message = '请求参数格式不正确',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError(message);
  return value as Record<string, unknown>;
}
