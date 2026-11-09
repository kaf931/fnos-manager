import { AiApplicationService } from '../terminal/ai.service.js';
import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StorageOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { ConfirmDto } from '../tasks/dto.js';
import {
  ScanComparisonQueryDto,
  DeleteHistoryDto,
  AiAttachmentQueryDto,
  DuplicateActionDto,
  PathDto,
  RenamePreviewDto,
  ScanDto,
  ScanEntriesQueryDto,
  HistoryQueryDto,
  ScanHistoryQueryDto,
} from './dto.js';
import { StorageService } from './storage.service.js';
@UseGuards(StorageOwnerGuard)
@Controller('app/deskicons/api')
export class StorageController {
  constructor(
    @Inject(StorageService) private readonly service: StorageService,
    @Inject(AiApplicationService) private readonly ai: AiApplicationService,
  ) {}
  @Get('storage/attachments')
  attachments(@Req() req: ApiRequest, @Query() query: AiAttachmentQueryDto) {
    return this.ai.listAttachments(req.storageOwner, query);
  }
  @HttpCode(200)
  @Post('storage/attachments/delete')
  cleanAttachments(@Req() req: ApiRequest, @Body() body: DeleteHistoryDto) {
    if (!body.confirmed) throw new BadRequestException('请确认清理附件');
    return this.ai.cleanAttachments(req.storageOwner, body.ids);
  }
  @HttpCode(200)
  @Post('storage/attachments/orphans')
  cleanOrphans(@Body() body: ConfirmDto) {
    if (!body.confirmed) throw new BadRequestException('请确认清理附件');
    return this.ai.attachments.cleanOrphans();
  }
  @Get('storage/scans/:id/entries')
  getStorageScanEntries(@Req() req: ApiRequest, @Query() query: ScanEntriesQueryDto) {
    return this.service.scanEntries(req.storageOwner, req.params.id, query);
  }
  @HttpCode(200)
  @Post('storage/resolve')
  async postStorageResolve(@Req() req: ApiRequest, @Body() inputDto: PathDto) {
    const { service } = this.service;
    return { path: await service.resolve(inputDto?.path) };
  }
  @Get('storage/directories')
  async getStorageDirectories(@Req() req: ApiRequest) {
    const { service } = this.service;
    return await service.browse(req.query.path);
  }
  @Get('storage/scans')
  async getStorageScans(@Req() req: ApiRequest, @Query() query: ScanHistoryQueryDto) {
    const { service } = this.service;
    return query.page === undefined
      ? service.list(req.storageOwner)
      : this.service.scanHistory(req.storageOwner, { ...query, page: query.page });
  }
  @HttpCode(200)
  @Post('storage/scans/delete')
  async postStorageScansDelete(@Req() req: ApiRequest, @Body() inputDto: DeleteHistoryDto) {
    const { service } = this.service;
    return await service.deleteRecords(req.storageOwner, inputDto);
  }
  @HttpCode(202)
  @Post('storage/scans')
  async postStorageScans(@Req() req: ApiRequest, @Body() inputDto: ScanDto) {
    const { service } = this.service;
    return await service.start(req.storageOwner, inputDto);
  }
  @Get('storage/scans/:id/comparison')
  compareScans(@Req() req: ApiRequest, @Query() query: ScanComparisonQueryDto) {
    return this.service.compareScans(req.storageOwner, query.before, req.params.id, query);
  }
  @Get('storage/scans/:id')
  async getStorageScansById(@Req() req: ApiRequest) {
    const { service } = this.service;
    return service.get(req.storageOwner, req.params.id);
  }
  @HttpCode(200)
  @Post('storage/scans/:id/cancel')
  async postStorageScansByIdCancel(@Req() req: ApiRequest) {
    const { service } = this.service;
    return service.cancel(req.storageOwner, req.params.id);
  }
  @HttpCode(200)
  @Post('storage/scans/:id/duplicates/process')
  async postStorageScansByIdDuplicatesProcess(
    @Req() req: ApiRequest,
    @Body() inputDto: DuplicateActionDto,
  ) {
    const { duplicates } = this.service;
    return await duplicates.process(req.storageOwner, req.params.id, inputDto);
  }
  @Get('storage/rename/files')
  async getStorageRenameFiles(@Req() req: ApiRequest) {
    const { rename } = this.service;
    return await rename.files(req.query.path);
  }
  @HttpCode(200)
  @Post('storage/rename/previews')
  async postStorageRenamePreviews(@Req() req: ApiRequest, @Body() inputDto: RenamePreviewDto) {
    const { rename } = this.service;
    return await rename.preview(req.storageOwner, inputDto);
  }
  @HttpCode(200)
  @Post('storage/rename/previews/:id/execute')
  async postStorageRenamePreviewsByIdExecute(@Req() req: ApiRequest, @Body() inputDto: ConfirmDto) {
    const { rename } = this.service;
    return await rename.execute(req.storageOwner, req.params.id, inputDto);
  }
  @HttpCode(200)
  @Post('storage/rename/records/delete')
  async postStorageRenameRecordsDelete(@Req() req: ApiRequest, @Body() inputDto: DeleteHistoryDto) {
    const { rename } = this.service;
    return await rename.deleteRecords(req.storageOwner, inputDto);
  }
  @Get('storage/rename/records')
  async getStorageRenameRecords(@Req() req: ApiRequest, @Query() query: HistoryQueryDto) {
    const { rename } = this.service;
    return query.page === undefined
      ? rename.list(req.storageOwner)
      : this.service.renameHistory(req.storageOwner, { ...query, page: query.page });
  }
  @Get('storage/rename/records/:id')
  async getStorageRenameRecordsById(@Req() req: ApiRequest) {
    const { rename } = this.service;
    return rename.get(req.storageOwner, req.params.id);
  }
  @HttpCode(200)
  @Post('storage/rename/records/:id/undo')
  async postStorageRenameRecordsByIdUndo(@Req() req: ApiRequest, @Body() inputDto: ConfirmDto) {
    const { rename } = this.service;
    return await rename.undo(req.storageOwner, req.params.id, inputDto);
  }
}
