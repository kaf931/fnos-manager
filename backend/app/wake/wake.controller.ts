import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/types.js';
import { PowerBatchDto, WakeBatchDto, WakeDeviceDto } from './dto.js';
import { WakeService } from './wake.service.js';
@Controller('app/deskicons/api')
export class WakeController {
  constructor(@Inject(WakeService) private readonly service: WakeService) {}
  @HttpCode(200)
  @Post('wake/discover')
  async discover() {
    return this.service.discovery.scan();
  }
  @Get('wake/devices')
  async getWakeDevices(@Req() req: ApiRequest) {
    const { service, owner } = this.service;
    return service.list(owner(req));
  }
  @HttpCode(201)
  @Post('wake/devices')
  async postWakeDevices(@Req() req: ApiRequest, @Body() inputDto: WakeDeviceDto) {
    const { service, owner } = this.service;
    return await service.save(owner(req), inputDto);
  }
  @Put('wake/devices/:id')
  async putWakeDevicesById(@Req() req: ApiRequest, @Body() inputDto: WakeDeviceDto) {
    const { service, owner } = this.service;
    return await service.save(owner(req), inputDto, req.params.id);
  }
  @HttpCode(204)
  @Delete('wake/devices/:id')
  async deleteWakeDevicesById(@Req() req: ApiRequest) {
    const { service, owner } = this.service;
    await service.remove(owner(req), req.params.id);
  }
  @HttpCode(200)
  @Post('wake/check')
  async check(@Req() req: ApiRequest, @Body() inputDto: WakeBatchDto) {
    return this.service.service.checkMany(this.service.owner(req), inputDto);
  }
  @HttpCode(200)
  @Post('wake/control')
  async postWakeControl(@Req() req: ApiRequest, @Body() inputDto: PowerBatchDto) {
    const { service, owner } = this.service;
    return await service.controlMany(owner(req), inputDto);
  }
  @HttpCode(200)
  @Post('wake/batch')
  async postWakeBatch(@Req() req: ApiRequest, @Body() inputDto: WakeBatchDto) {
    const { service, owner } = this.service;
    return await service.wakeMany(owner(req), inputDto);
  }
  @HttpCode(200)
  @Post('wake/devices/:id/wake')
  async postWakeDevicesByIdWake(@Req() req: ApiRequest) {
    const { service, owner } = this.service;
    return await service.wake(owner(req), req.params.id);
  }
}
