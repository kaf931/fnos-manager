import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { BackupService } from '../../backup/service.js';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { ExportBackupDto, PreviewBackupDto, RestoreBackupDto } from './dto.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/backup')
export class BackupController {
  constructor(@Inject(BackupService) private readonly service: BackupService) {}
  @Post('export') @HttpCode(200) export(@Req() req: ApiRequest, @Body() input: ExportBackupDto) {
    return this.service.export(req.terminalOwner, input);
  }
  @Post('preview') @HttpCode(200) preview(@Req() req: ApiRequest, @Body() input: PreviewBackupDto) {
    return this.service.preview(req.terminalOwner, input.backup);
  }
  @Post('restore') @HttpCode(200) restore(@Req() req: ApiRequest, @Body() input: RestoreBackupDto) {
    return this.service.restore(req.terminalOwner, input);
  }
}
