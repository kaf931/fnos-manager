import { Body, Controller, Get, Inject, Put, Query, Req, UseGuards } from '@nestjs/common';
import { OperationService } from '../../operations/service.js';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { OperationPageDto, SettingsDto } from './dto.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/operations')
export class OperationsController {
  constructor(@Inject(OperationService) private readonly service: OperationService) {}
  @Get() list(@Req() req: ApiRequest, @Query() query: OperationPageDto) {
    return this.service.list(
      req.terminalOwner,
      query.page,
      query.pageSize,
      query.action,
      query.status,
    );
  }
  @Get('settings') settings(@Req() req: ApiRequest) {
    return this.service.settings(req.terminalOwner);
  }
  @Put('settings') save(@Req() req: ApiRequest, @Body() input: SettingsDto) {
    return this.service.saveSettings(req.terminalOwner, input.retention);
  }
}
