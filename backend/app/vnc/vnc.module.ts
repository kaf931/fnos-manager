import { Module } from '@nestjs/common';
import { VncController } from './vnc.controller.js';
import { VncService } from './vnc.service.js';
@Module({ controllers: [VncController], providers: [VncService] })
export class VncModule {}
