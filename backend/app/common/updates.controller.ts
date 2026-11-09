import { Body, Controller, Get, Post, Put, Inject, UseGuards } from '@nestjs/common';
import { IsString, Matches, IsIn, IsOptional } from 'class-validator';
import type { UpdateMode, UpdateDownloadRoute } from '../../domain/updates.js';
import { TerminalOwnerGuard } from './security.js';
import { UpdatesService } from './updates.service.js';
class UpdateModeDto {
  @IsOptional() @IsIn(['manual', 'auto']) mode?: UpdateMode;
  @IsOptional() @IsIn(['direct', 'mirror']) downloadRoute?: UpdateDownloadRoute;
}
class CancelDto {
  @IsString() @Matches(/^[a-f0-9-]{36}$/) id!: string;
}
class InstallDto {
  @IsString() @Matches(/^v?\d+\.\d+\.\d+$/) version!: string;
}
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/updates')
export class UpdatesController {
  constructor(@Inject(UpdatesService) private readonly service: UpdatesService) {}
  @Get('settings') settings() {
    return this.service.settings();
  }
  @Put('settings') settingsSave(@Body() input: UpdateModeDto) {
    return this.service.saveSettings(input.mode, input.downloadRoute);
  }
  @Get('status') status() {
    return this.service.status();
  }
  @Post('cancel') cancel(@Body() input: CancelDto) {
    return this.service.cancel(input.id);
  }
  @Post('install') install(@Body() input: InstallDto) {
    return this.service.install(input.version);
  }
  @Get() check() {
    return this.service.check(true);
  }
}
