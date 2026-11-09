import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { VncService } from './vnc.service.js';
import { VncConnectionDto, VncSessionDto, VncFolderDto, VncSettingsDto } from './dto.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/vnc')
export class VncController {
  constructor(@Inject(VncService) private readonly service: VncService) {}
  @Get('settings') settings(@Req() req: ApiRequest) {
    return this.service.getSettings(req.terminalOwner);
  }
  @Put('settings') saveSettings(@Req() req: ApiRequest, @Body() input: VncSettingsDto) {
    return this.service.saveSettings(req.terminalOwner, input);
  }
  @Get('connections') list(@Req() req: ApiRequest) {
    return this.service.list(req.terminalOwner);
  }
  @Post('connections') save(@Req() req: ApiRequest, @Body() input: VncConnectionDto) {
    return this.service.save(req.terminalOwner, input);
  }
  @Put('connections/:id') update(@Req() req: ApiRequest, @Body() input: VncConnectionDto) {
    return this.service.save(req.terminalOwner, input, req.params.id);
  }
  @Put('connections/:id/folder') move(@Req() req: ApiRequest, @Body() input: VncFolderDto) {
    return this.service.move(req.terminalOwner, req.params.id, input.folderId ?? null);
  }
  @Delete('connections/:id') @HttpCode(204) remove(@Req() req: ApiRequest) {
    this.service.remove(req.terminalOwner, req.params.id);
  }
  @Post('sessions') create(@Req() req: ApiRequest, @Body() input: VncSessionDto) {
    return this.service.create(req, input.connectionId);
  }
  @Delete('sessions/:id') @HttpCode(204) close(@Req() req: ApiRequest) {
    this.service.close(req.terminalOwner, req.params.id);
  }
  @Get('sessions/:id/logs') logs(@Req() req: ApiRequest) {
    return this.service.logs(req.terminalOwner, req.params.id);
  }
}
