import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, errorInfo } from '../../errors.js';
export function errorResponse(error: unknown) {
  const info = errorInfo(error),
    code = info.code;
  const declared =
    error instanceof HttpException ||
    error instanceof DomainError ||
    (info.status !== undefined &&
      Number.isInteger(info.status) &&
      info.status >= 400 &&
      info.status < 500);
  const status =
    error instanceof HttpException ? error.getStatus() : declared ? (info.status ?? 400) : 500;
  let message = declared ? info.message : '服务内部错误，请稍后重试';
  if (code === 'ENOENT') message = '所需工具或文件不存在，请检查应用安装';
  else if (info.message.startsWith('Command failed'))
    message = '系统操作未完成，请检查应用日志后重试';
  return { status, error: message };
}
export interface ErrorDiagnostic {
  event: 'request_failed';
  method: string;
  path: string;
  kind: string;
  code?: string;
  stack: string;
}
export function diagnostic(
  error: unknown,
  request: { method?: string; path?: string },
): ErrorDiagnostic {
  const info = errorInfo(error);
  return {
    event: 'request_failed',
    method: request.method ?? '',
    path: request.path ?? '',
    kind: error instanceof Error ? error.name : 'UnknownError',
    ...(info.code && /^[A-Z0-9_]+$/.test(info.code) ? { code: info.code } : {}),
    stack:
      error instanceof Error
        ? (error.stack ?? '')
            .split('\n')
            .filter((line) => /^\s+at /.test(line))
            .slice(0, 12)
            .join('\n')
        : '',
  };
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly report: (event: ErrorDiagnostic) => void = (event) =>
      console.error(JSON.stringify(event)),
  ) {}
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const result = errorResponse(error);
    if (result.status >= 500)
      this.report(
        diagnostic(error, host.switchToHttp().getRequest<{ method?: string; path?: string }>()),
      );
    response.status(result.status).json({ error: result.error });
  }
}
