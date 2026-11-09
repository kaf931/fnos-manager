import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestOwner } from '../../terminal/transport.js';
import { Resources } from './resources.js';
import { APP_OPTIONS, type ApiRequest, type AppOptions } from './types.js';
const verified = Symbol('gateway-verified');
@Injectable()
export class GatewayAccess {
  constructor(
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
    @Inject(Resources) private readonly resources: Resources,
  ) {}
  authorize(req: Request & { [verified]?: boolean }) {
    if (req[verified]) return;
    if (this.resources.shuttingDown)
      throw new ServiceUnavailableException('应用正在停止，请稍后重试');
    const { gateway, csrfToken } = this.options;
    if (gateway && req.headers['x-trim-isadmin'] !== 'true')
      throw new ForbiddenException('仅管理员可以使用 NAS 管家');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (existsSync(path.join(this.options.dataDir, 'updates', 'installing')))
        throw new ServiceUnavailableException('应用正在更新，请稍后重试');
      if (gateway && req.headers['x-deskicons-token'] !== csrfToken)
        throw new ForbiddenException('页面会话已更新，请刷新后重试');
      const origin = gateway ? null : req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) throw new Error();
        } catch {
          throw new ForbiddenException('请求来源不匹配');
        }
      }
    }
    req[verified] = true;
  }
  headers(res: Response) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Cache-Control', 'no-store');
  }
}
@Injectable()
export class GatewayGuard implements CanActivate {
  constructor(@Inject(GatewayAccess) private readonly access: GatewayAccess) {}
  canActivate(context: ExecutionContext) {
    this.access.authorize(context.switchToHttp().getRequest());
    return true;
  }
}
@Injectable()
export class TerminalOwnerGuard implements CanActivate {
  constructor(@Inject(APP_OPTIONS) private readonly options: AppOptions) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    req.terminalOwner = requestOwner(req, this.options.gateway);
    return true;
  }
}
@Injectable()
export class StorageOwnerGuard implements CanActivate {
  constructor(@Inject(APP_OPTIONS) private readonly options: AppOptions) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    req.storageOwner = requestOwner(req, this.options.gateway);
    return true;
  }
}
