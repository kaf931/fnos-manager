import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/types.js';
import { AuthorizeDto, ConfirmDto, ExchangeDto, TaskDto } from './dto.js';
import { TasksService } from './tasks.service.js';
@Controller('app/deskicons/api')
export class TasksController {
  constructor(@Inject(TasksService) private readonly service: TasksService) {}
  @Get('task-device-options')
  async getTaskDeviceOptions(@Req() req: ApiRequest) {
    return this.service.deviceOptions(req);
  }
  @Get('task-capabilities')
  async getTaskCapabilities(@Req() req: ApiRequest) {
    return this.service.capabilities(req);
  }
  @Get('programs')
  async getPrograms(@Req() req: ApiRequest) {
    return this.service.programs(req);
  }
  @Get('tasks')
  async getTasks(@Req() req: ApiRequest) {
    return this.service.listTasks(req);
  }
  @Get('task-runs')
  async getTaskRuns(@Req() req: ApiRequest) {
    return this.service.listRuns(req);
  }
  @HttpCode(201)
  @Post('tasks')
  async postTasks(@Req() req: ApiRequest, @Body() inputDto: TaskDto) {
    return this.service.createTask(req, inputDto);
  }
  @Put('tasks/:id')
  async putTasksById(@Req() req: ApiRequest, @Body() inputDto: TaskDto) {
    return this.service.updateTask(req, inputDto);
  }
  @HttpCode(204)
  @Delete('tasks/:id')
  async deleteTasksById(@Req() req: ApiRequest) {
    return this.service.removeTask(req);
  }
  @HttpCode(202)
  @Post('tasks/:id/run')
  async postTasksByIdRun(@Req() req: ApiRequest, @Body() inputDto: ConfirmDto) {
    return this.service.runTask(req, inputDto);
  }
  @HttpCode(200)
  @Post('tasks/:id/preview')
  async postTasksByIdPreview(@Req() req: ApiRequest) {
    return this.service.previewTask(req);
  }
  @Get('tasks/:id/runs')
  async getTasksByIdRuns(@Req() req: ApiRequest) {
    return this.service.taskRuns(req);
  }
  @Get('official/status')
  async getOfficialStatus(@Req() req: ApiRequest) {
    return this.service.officialStatus(req);
  }
  @HttpCode(200)
  @Post('official/authorize')
  async postOfficialAuthorize(@Req() req: ApiRequest, @Body() inputDto: AuthorizeDto) {
    return this.service.authorizeOfficial(req, inputDto);
  }
  @HttpCode(200)
  @Post('official/exchange')
  async postOfficialExchange(@Req() req: ApiRequest, @Body() inputDto: ExchangeDto) {
    return this.service.exchangeOfficial(req, inputDto);
  }
  @HttpCode(200)
  @Post('official/disconnect')
  async postOfficialDisconnect(@Req() req: ApiRequest) {
    return this.service.disconnectOfficial(req);
  }
  @Get('official/log-modules')
  async getOfficialLogModules(@Req() req: ApiRequest) {
    return this.service.officialLogModules(req);
  }
}
