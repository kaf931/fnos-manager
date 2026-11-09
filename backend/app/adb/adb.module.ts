import { Module } from '@nestjs/common';
import { AdbService } from './adb.service.js';
import { AdbController } from './adb.controller.js';
@Module({ controllers: [AdbController], providers: [AdbService] })
export class AdbModule {}
