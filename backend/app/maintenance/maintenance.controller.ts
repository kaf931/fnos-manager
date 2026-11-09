import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Query,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StorageOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { MaintenanceService } from './maintenance.service.js';
import {
  CleanupDto,
  BatchKindDto,
  DeleteRecordsDto,
  HistoryLimitsDto,
  MaintenanceKindDto,
  MaintenanceDetailDto,
  MaintenancePageDto,
} from './dto.js';
@UseGuards(StorageOwnerGuard)
@Controller('app/deskicons/api/storage/cleanup')
export class MaintenanceController {
  constructor(@Inject(MaintenanceService) private service: MaintenanceService) {}
  @Get() summary(@Req() req: ApiRequest) {
    return this.service.summary(req.storageOwner);
  }
  @Get('records/:kind') records(
    @Req() req: ApiRequest,
    @Param() params: MaintenanceKindDto,
    @Query() query: MaintenancePageDto,
  ) {
    return this.service.records(params.kind, req.storageOwner, query.page, query.pageSize);
  }
  @Get('records/:kind/:id') detail(@Req() req: ApiRequest, @Param() params: MaintenanceDetailDto) {
    return this.service.recordDetail(params.kind, req.storageOwner, params.id);
  }
  @Post('records/:kind/delete') @HttpCode(200) removeSelected(
    @Req() req: ApiRequest,
    @Param() params: BatchKindDto,
    @Body() input: DeleteRecordsDto,
  ) {
    return this.service.removeSelected(req.storageOwner, params.kind, input.ids, input.confirmed);
  }
  @Get('settings') settings() {
    return this.service.limits();
  }
  @Put('settings') save(@Body() input: HistoryLimitsDto) {
    return this.service.save(input);
  }
  @Post() @HttpCode(200) clean(@Req() req: ApiRequest, @Body() input: CleanupDto) {
    return this.service.clean(req.storageOwner, input.kinds, input.confirmed);
  }
}
