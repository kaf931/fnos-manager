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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { AdbService } from './adb.service.js';
import {
  AdbConnectionDto,
  AdbFolderDto,
  AdbPairDto,
  AdbRenameDto,
  AdbSessionDto,
  AdbShellDto,
} from './dto.js';
import { remotePath } from '../../adb/model.js';
import { fail } from '../../terminal/model.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/adb')
export class AdbController {
  constructor(@Inject(AdbService) private readonly service: AdbService) {}
  @Get('connections') list(@Req() r: ApiRequest) {
    return this.service.list(r.terminalOwner);
  }
  @Post('connections') save(@Req() r: ApiRequest, @Body() v: AdbConnectionDto) {
    return this.service.save(r.terminalOwner, v);
  }
  @Put('connections/:id') update(@Req() r: ApiRequest, @Body() v: AdbConnectionDto) {
    return this.service.save(r.terminalOwner, v, r.params.id);
  }
  @Put('connections/:id/folder') move(@Req() r: ApiRequest, @Body() v: AdbFolderDto) {
    return this.service.move(r.terminalOwner, r.params.id, v.folderId ?? null);
  }
  @Delete('connections/:id') @HttpCode(204) remove(@Req() r: ApiRequest) {
    this.service.remove(r.terminalOwner, r.params.id);
  }
  @Get('devices') devices(@Req() r: ApiRequest) {
    return this.service.sessions.devices(r.terminalOwner);
  }
  @Post('pair') pair(@Req() r: ApiRequest, @Body() v: AdbPairDto) {
    return this.service.sessions.pair(r.terminalOwner, v.host, v.port, v.code);
  }
  @Post('sessions') create(@Req() r: ApiRequest, @Body() v: AdbSessionDto) {
    return this.service.create(r, v.connectionId);
  }
  @Delete('sessions/:id') @HttpCode(204) close(@Req() r: ApiRequest) {
    this.service.sessions.closeOwned(r.terminalOwner, r.params.id);
  }
  @Get('sessions/:id/logs') logs(@Req() r: ApiRequest) {
    return { items: this.service.sessions.logs.read(r.terminalOwner, r.params.id) };
  }
  @Get('sessions/:id/info') info(@Req() r: ApiRequest) {
    return this.service.sessions.info(r.terminalOwner, r.params.id);
  }
  @Post('sessions/:id/shell') shell(@Req() r: ApiRequest, @Body() v: AdbShellDto) {
    return this.service.sessions.shell(r.terminalOwner, r.params.id, v.command);
  }
  @Post('sessions/:id/terminal') terminal(@Req() r: ApiRequest) {
    return this.service.transport.ticket(r.terminalOwner, r.params.id, 'terminal');
  }
  @Post('sessions/:id/screen') screen(@Req() r: ApiRequest) {
    return this.service.transport.ticket(r.terminalOwner, r.params.id, 'screen');
  }
  @Get('sessions/:id/files') files(@Req() r: ApiRequest) {
    return this.service.sessions.files(r.terminalOwner, r.params.id, r.query.path);
  }
  @Delete('sessions/:id/files') deleteFile(@Req() r: ApiRequest) {
    return this.service.sessions.deleteFile(r.terminalOwner, r.params.id, r.query.path);
  }
  @Put('sessions/:id/files') rename(@Req() r: ApiRequest, @Body() v: AdbRenameDto) {
    return this.service.sessions.rename(r.terminalOwner, r.params.id, v.path, v.target);
  }
  @Post('sessions/:id/files/upload')
  upload(@Req() r: ApiRequest, @Res({ passthrough: true }) res: Response) {
    return this.receive(r, res, false);
  }
  @Post('sessions/:id/install')
  install(@Req() r: ApiRequest, @Res({ passthrough: true }) res: Response) {
    return this.receive(r, res, true);
  }
  private async receive(r: ApiRequest, res: Response, install: boolean) {
    this.binary(r);
    const abort = new AbortController();
    const cancel = () => {
      if (!res.writableFinished) abort.abort();
    };
    r.once('aborted', cancel);
    res.once('close', cancel);
    try {
      return await this.service.sessions.upload(
        r.terminalOwner,
        r.params.id,
        r,
        r.query.path,
        install,
        abort.signal,
      );
    } finally {
      r.off('aborted', cancel);
      res.off('close', cancel);
    }
  }
  private binary(r: ApiRequest) {
    if (r.headers['content-type']?.split(';')[0] !== 'application/octet-stream')
      throw fail('请以二进制文件格式上传');
    const length = Number(r.headers['content-length']);
    if (Number.isFinite(length) && length > 256 * 1024 * 1024)
      throw fail('单次传输不能超过 256 MiB', 413);
  }
  @Get('sessions/:id/files/download') async download(@Req() r: ApiRequest, @Res() res: Response) {
    const p = remotePath(r.query.path);
    this.service.sessions.get(r.terminalOwner, r.params.id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(p.split('/').pop() || 'download')}`,
    );
    try {
      await this.service.sessions.download(r.terminalOwner, r.params.id, p, res);
    } catch (e) {
      if (res.headersSent) res.destroy();
      else throw e;
    }
  }
}
