import { Module } from '@nestjs/common';
import { RdpController } from './rdp.controller.js';
import { RdpService } from './rdp.service.js';
@Module({ controllers: [RdpController], providers: [RdpService] })
export class RdpModule {}
