import { AdbService } from './adb/adb.service.js';
import { validateOptions } from './common/config.js';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter, errorResponse } from './common/errors.js';
import { TerminalService } from './terminal/terminal.service.js';
import { RdpService } from './rdp/rdp.service.js';
import { VncService } from './vnc/vnc.service.js';
import { Resources } from './common/resources.js';
import { GatewayAccess, GatewayGuard } from './common/security.js';
import type { AppOptions } from './common/types.js';
import { standaloneDocument, standalonePage } from './common/entry-document.js';
export async function createApplication(options: AppOptions) {
  validateOptions(options);
  const resources = new Resources();
  let nest: NestExpressApplication | undefined;
  try {
    nest = await NestFactory.create<NestExpressApplication>(
      AppModule.register(options, resources),
      new ExpressAdapter(),
      { bodyParser: false, logger: false, abortOnError: false },
    );
    const access = nest.get(GatewayAccess);
    const app = nest.getHttpAdapter().getInstance();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
      access.headers(res);
      try {
        access.authorize(req);
        next();
      } catch (error) {
        const result = errorResponse(error);
        res.status(result.status).json({ error: result.error });
      }
    });
    app.use(
      '/app/deskicons/api/terminal/ai/skill-packages/upload',
      express.raw({ type: 'application/zip', limit: '10mb' }),
    );
    app.use('/app/deskicons/api/terminal/sessions/:id/files/text', express.json({ limit: '64mb' }));
    app.use('/app/deskicons/api/backup/preview', express.json({ limit: '33mb' }));
    app.use(express.json({ limit: '8mb' }));
    nest.useGlobalGuards(nest.get(GatewayGuard));
    nest.useGlobalFilters(new ApiExceptionFilter());
    nest.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transformOptions: { enableImplicitConversion: false },
        validationError: { target: false, value: false },
        exceptionFactory: () => new BadRequestException('请求参数格式不正确，请检查填写内容'),
      }),
    );
    app.get(
      ['/app/deskicons', '/app/deskicons/', '/app/deskicons/index.html'],
      async (req, res, next) => {
        const page = standalonePage(req.originalUrl);
        if (!page) return next();
        try {
          const html = await readFile(path.join(options.root, 'dist', 'index.html'), 'utf8');
          res.type('html').send(standaloneDocument(html, page));
        } catch (error) {
          next(error);
        }
      },
    );
    app.use(
      '/app/deskicons',
      express.static(path.join(options.root, 'dist'), {
        index: 'index.html',
        setHeaders(res, file) {
          // Only versioned build assets are reusable; HTML and user data stay no-store.
          if (/^[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path.basename(file)))
            res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        },
      }),
    );

    await nest.init();
    nest.get(TerminalService).service.attach(nest.getHttpServer());
    nest.get(VncService).transport.attach(nest.getHttpServer());
    nest.get(AdbService).transport.attach(nest.getHttpServer());
    nest.get(RdpService).transport.attach(nest.getHttpServer());
    return nest;
  } catch (error) {
    try {
      if (nest) await nest.close();
      else await resources.close();
    } catch {}
    throw error;
  }
}
