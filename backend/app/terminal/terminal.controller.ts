import { Transform } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { fail } from '../../terminal/model.js';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import {
  TextFileDto,
  ArchiveDto,
  CatalogCommandDto,
  ConnectionDto,
  FileDto,
  FolderDto,
  PermissionDto,
  SessionDto,
  WorkspaceDto,
} from './dto.js';
import { readTextFile, saveTextFile } from '../../terminal/text-files.js';
import { TerminalService } from './terminal.service.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api')
export class TerminalController {
  constructor(@Inject(TerminalService) private readonly service: TerminalService) {}
  @Get('terminal/command-catalog')
  commandCatalog(@Req() req: ApiRequest) {
    return this.service.commandCatalog(req.terminalOwner);
  }
  @Post('terminal/command-catalog')
  addCatalogCommand(@Req() req: ApiRequest, @Body() input: CatalogCommandDto) {
    return this.service.saveCatalogCommand(req.terminalOwner, input);
  }
  @Put('terminal/command-catalog/:id')
  editCatalogCommand(@Req() req: ApiRequest, @Body() input: CatalogCommandDto) {
    return this.service.saveCatalogCommand(req.terminalOwner, input, req.params.id);
  }
  @HttpCode(204)
  @Delete('terminal/command-catalog/:id')
  deleteCatalogCommand(@Req() req: ApiRequest) {
    this.service.removeCatalogCommand(req.terminalOwner, req.params.id);
  }
  @HttpCode(204)
  @Post('terminal/sessions/:id/transfers/:transferId/cancel')
  cancelTransfer(@Req() req: ApiRequest) {
    this.service.service.connectedOwned(req.terminalOwner, req.params.id);
    this.service.transfers.cancel(req.terminalOwner, req.params.id, req.params.transferId);
  }
  @Get('terminal/transfers')
  @Header('Cache-Control', 'no-store')
  getTransfers(@Req() req: ApiRequest) {
    if (typeof req.query.sessionId !== 'string') throw fail('请选择终端会话');
    return this.service.transfers.list(
      req.terminalOwner,
      req.query.sessionId,
      req.query.summary === 'true',
    );
  }
  @Get('terminal/workspace')
  async getTerminalWorkspace(@Req() req: ApiRequest) {
    const { workspace } = this.service;
    return workspace.list(req.terminalOwner, req.query.scope);
  }
  @HttpCode(201)
  @Post('terminal/workspace')
  async postTerminalWorkspace(@Req() req: ApiRequest, @Body() inputDto: WorkspaceDto) {
    const { workspace } = this.service;
    return await workspace.save(req.terminalOwner, inputDto);
  }
  @Put('terminal/workspace/:id')
  async putTerminalWorkspaceById(@Req() req: ApiRequest, @Body() inputDto: WorkspaceDto) {
    const { workspace } = this.service;
    return await workspace.save(req.terminalOwner, inputDto, req.params.id);
  }
  @HttpCode(204)
  @Delete('terminal/workspace/:id')
  async deleteTerminalWorkspaceById(@Req() req: ApiRequest) {
    const { workspace } = this.service;
    await workspace.remove(req.terminalOwner, req.params.id);
  }
  @Get('terminal/sessions/:id/monitor')
  @Header('Cache-Control', 'no-store')
  async getTerminalSessionsByIdMonitor(@Req() req: ApiRequest) {
    const { service } = this.service;

    return await service.connectedOwned(req.terminalOwner, req.params.id).monitor();
  }
  @Get('terminal/connections')
  async getTerminalConnections(@Req() req: ApiRequest) {
    const { store } = this.service;
    return store.list(req.terminalOwner);
  }
  @HttpCode(201)
  @Post('terminal/connections')
  async postTerminalConnections(@Req() req: ApiRequest, @Body() inputDto: ConnectionDto) {
    const { store } = this.service;
    return await store.save(req.terminalOwner, inputDto);
  }
  @Put('terminal/connections/:id/folder')
  async putTerminalConnectionsByIdFolder(@Req() req: ApiRequest, @Body() inputDto: FolderDto) {
    const { store } = this.service;
    return await store.move(req.terminalOwner, req.params.id, inputDto?.folderId);
  }
  @Put('terminal/connections/:id')
  async putTerminalConnectionsById(@Req() req: ApiRequest, @Body() inputDto: ConnectionDto) {
    return this.service.updateConnection(req.terminalOwner, req.params.id, inputDto);
  }
  @HttpCode(204)
  @Delete('terminal/connections/:id')
  async deleteTerminalConnectionsById(@Req() req: ApiRequest) {
    return this.service.removeConnection(req.terminalOwner, req.params.id);
  }
  @HttpCode(201)
  @Post('terminal/sessions')
  async postTerminalSessions(@Req() req: ApiRequest, @Body() inputDto: SessionDto) {
    return this.service.createSession(req, inputDto);
  }
  @HttpCode(204)
  @Delete('terminal/sessions/:id')
  async deleteTerminalSessionsById(@Req() req: ApiRequest) {
    const { service } = this.service;
    service.closeOwned(req.terminalOwner, req.params.id);
  }
  @HttpCode(200)
  @Post('terminal/sessions/:id/files/size')
  async postTerminalSessionsByIdFilesSize(@Req() req: ApiRequest, @Body() inputDto: FileDto) {
    const { files } = this.service;
    const { path, name } = inputDto || {};
    return await files(req).calculateSize(path, name);
  }
  @Get('terminal/sessions/:id/files/permissions')
  async getTerminalSessionsByIdFilesPermissions(@Req() req: ApiRequest) {
    const { files } = this.service;
    return await files(req).permissionInfo(req.query.path, req.query.name);
  }
  @HttpCode(204)
  @Post('terminal/sessions/:id/files/permissions')
  async postTerminalSessionsByIdFilesPermissions(
    @Req() req: ApiRequest,
    @Body() inputDto: PermissionDto,
  ) {
    const { files } = this.service;
    const { path, name, mode } = inputDto || {};
    await files(req).chmod(path, name, mode);
  }
  @HttpCode(200)
  @Post('terminal/sessions/:id/files/compress')
  async postTerminalSessionsByIdFilesCompress(
    @Req() req: ApiRequest,
    @Body() inputDto: ArchiveDto,
  ) {
    const { files } = this.service;
    const { path, name, outputName, format } = inputDto || {};
    return await files(req).archive('compress', path, name, outputName, format);
  }
  @HttpCode(200)
  @Post('terminal/sessions/:id/files/extract')
  async postTerminalSessionsByIdFilesExtract(@Req() req: ApiRequest, @Body() inputDto: ArchiveDto) {
    const { files } = this.service;
    const { path, name, outputName, format } = inputDto || {};
    return await files(req).archive('extract', path, name, outputName, format);
  }
  @Get('terminal/sessions/:id/files/text/versions')
  @Header('Cache-Control', 'no-store')
  listTextVersions(@Req() req: ApiRequest) {
    return this.service.fileVersions(req, 'list');
  }
  @Get('terminal/sessions/:id/files/text/versions/:versionId')
  @Header('Cache-Control', 'no-store')
  readTextVersion(@Req() req: ApiRequest) {
    return this.service.fileVersions(req, 'read');
  }
  @Delete('terminal/sessions/:id/files/text/versions/:versionId')
  @HttpCode(204)
  deleteTextVersion(@Req() req: ApiRequest) {
    return this.service.fileVersions(req, 'delete');
  }
  @Get('terminal/sessions/:id/files/text')
  readText(@Req() req: ApiRequest) {
    return readTextFile(this.service.files(req), req.query.path, req.query.encoding);
  }
  @HttpCode(200)
  @Post('terminal/sessions/:id/files/text')
  saveText(@Req() req: ApiRequest, @Body() input: TextFileDto) {
    return saveTextFile(this.service.files(req), input);
  }
  @Get('terminal/sessions/:id/files')
  async getTerminalSessionsByIdFiles(@Req() req: ApiRequest) {
    const { files } = this.service;
    return await files(req).list(req.query.path);
  }
  @HttpCode(204)
  @Post('terminal/sessions/:id/files/mkdir')
  async postTerminalSessionsByIdFilesMkdir(@Req() req: ApiRequest, @Body() inputDto: FileDto) {
    const { files } = this.service;
    const { path, name } = inputDto || {};
    await files(req).mkdir(path, name);
  }
  @HttpCode(204)
  @Post('terminal/sessions/:id/files/rename')
  async postTerminalSessionsByIdFilesRename(@Req() req: ApiRequest, @Body() inputDto: FileDto) {
    const { files } = this.service;
    const { path, name, newName } = inputDto || {};
    await files(req)['rename'](path, name, newName);
  }
  @HttpCode(204)
  @Post('terminal/sessions/:id/files/delete')
  async postTerminalSessionsByIdFilesDelete(@Req() req: ApiRequest, @Body() inputDto: FileDto) {
    const { files } = this.service;
    const { path, name } = inputDto || {};
    await files(req).remove(path, name);
  }
  @HttpCode(200)
  @Post('terminal/sessions/:id/files/upload')
  async postTerminalSessionsByIdFilesUpload(@Req() req: ApiRequest, @Res() res: Response) {
    const { files } = this.service;
    if (!req.is('application/octet-stream')) throw fail('上传需使用二进制文件内容');
    const f = files(req),
      size = Number(req.query.size);
    if (
      req.query.size === undefined ||
      (req.headers['content-length'] !== undefined &&
        Number(req.headers['content-length']) !== size)
    )
      throw fail('上传文件大小不匹配');
    const controller = new AbortController();
    const transfer = this.service.beginTransfer(req, 'upload', size, () => controller.abort());
    const abort = () => transfer.cancel();
    req.on('aborted', abort);
    const close = () => {
      if (!res.writableEnded) abort();
    };
    res.on('close', close);
    if (req.aborted) transfer.cancel();
    try {
      await transfer.ready;
      if (controller.signal.aborted) throw fail('传输已取消', 409);
      await f.upload(req.query.path, req.query.name, req, {
        size,
        signal: controller.signal,
        onProgress: (bytes) => transfer.progress(bytes),
      });
      transfer.finish('completed');
      res.sendStatus(201);
    } catch (error) {
      transfer.finish(controller.signal.aborted ? 'cancelled' : 'failed');
      throw error;
    } finally {
      req.off('aborted', abort);
      res.off('close', close);
    }
  }
  @Get('terminal/sessions/:id/files/download')
  async getTerminalSessionsByIdFilesDownload(@Req() req: ApiRequest, @Res() res: Response) {
    const { files } = this.service;
    let stream;
    const controller = new AbortController();
    const transfer = this.service.beginTransfer(req, 'download', 0, () => controller.abort());
    let expectedSize: number | undefined;
    let transferred = 0;
    const delivered = () =>
      transfer.finish(
        expectedSize !== undefined && transferred === expectedSize ? 'completed' : 'failed',
      );
    let interruptedBy: 'source' | 'client' | undefined = req.aborted ? 'client' : undefined;
    const clientAborted = () => {
      if (interruptedBy === 'source') return;
      interruptedBy ??= 'client';
      transfer.cancel();
    };
    const sourceFailed = () => {
      interruptedBy ??= 'source';
    };
    const closed = () => {
      if (!res.writableFinished) clientAborted();
    };
    req.once('aborted', clientAborted);
    res.once('close', closed);
    res.once('error', clientAborted);
    res.once('finish', delivered);
    if (req.aborted) transfer.cancel();
    try {
      await transfer.ready;
      if (controller.signal.aborted) throw fail('传输已取消', 409);
      const d = await files(req).download(req.query.path);
      stream = d.stream;
      // Observe the cause before pipeline propagates errors into the other streams.
      stream.once('error', sourceFailed);
      expectedSize = d.size;
      transfer.progress(0, d.size);
      res.attachment(d.name);
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Length', String(d.size));
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          transferred += chunk.length;
          transfer.progress(transferred);
          callback(null, chunk);
        },
      });
      await pipeline(stream, meter, res, { signal: controller.signal });
    } catch (e) {
      transfer.finish(
        controller.signal.aborted || interruptedBy === 'client' ? 'cancelled' : 'failed',
      );
      stream?.destroy();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      throw e;
    } finally {
      req.off('aborted', clientAborted);
      res.off('close', closed);
      res.off('error', clientAborted);
      res.off('finish', delivered);
      stream?.off('error', sourceFailed);
    }
  }
}
