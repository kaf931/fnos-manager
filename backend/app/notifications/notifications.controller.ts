import { InboxPageDto, ReadInboxDto, DeliveryPageDto } from './inbox.dto.js';
import { ReminderDto, ReminderCompleteDto, ReminderBatchDto } from './reminder.dto.js';
import {
  Body,
  Param,
  Delete,
  Patch,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from '../../notifications/service.js';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { SettingsDto, TemplateDto, TemplateEnabledDto } from './dto.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}
  @Get('inbox') inbox(@Req() req: ApiRequest, @Query() query: InboxPageDto) {
    return this.service.listInbox(
      req.terminalOwner,
      query.page,
      query.pageSize,
      query.filter,
      query.q,
    );
  }
  @Get('inbox/unread') inboxUnread(@Req() req: ApiRequest) {
    return this.service.inboxUnread(req.terminalOwner);
  }
  @Post('inbox/read') @HttpCode(200) readInbox(
    @Req() req: ApiRequest,
    @Body() input: ReadInboxDto,
  ) {
    return this.service.readInbox(req.terminalOwner, input.ids);
  }
  @Post('inbox/read-all') @HttpCode(200) readAllInbox(@Req() req: ApiRequest) {
    return this.service.readInbox(req.terminalOwner);
  }
  @Get('reminders') reminders(@Req() req: ApiRequest) {
    return this.service.listReminders(req.terminalOwner);
  }
  @Post('reminders') @HttpCode(200) createReminder(
    @Req() req: ApiRequest,
    @Body() input: ReminderDto,
  ) {
    return this.service.createReminder(req.terminalOwner, input);
  }
  @Post('reminders/batch') @HttpCode(200) batchReminders(
    @Req() req: ApiRequest,
    @Body() input: ReminderBatchDto,
  ) {
    return this.service.batchReminders(req.terminalOwner, input.ids, input.action);
  }
  @Put('reminders/:id') updateReminder(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() input: ReminderDto,
  ) {
    return this.service.updateReminder(req.terminalOwner, id, input);
  }
  @Patch('reminders/:id/enabled') enableReminder(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() input: TemplateEnabledDto,
  ) {
    return this.service.enableReminder(req.terminalOwner, id, input.enabled);
  }
  @Patch('reminders/:id/completed') completeReminder(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() input: ReminderCompleteDto,
  ) {
    return this.service.completeReminder(req.terminalOwner, id, input.completed);
  }
  @Delete('reminders/:id') deleteReminder(@Req() req: ApiRequest, @Param('id') id: string) {
    this.service.deleteReminder(req.terminalOwner, id);
    return { success: true };
  }
  @Get('templates') list(@Req() req: ApiRequest) {
    return this.service.listTemplates(req.terminalOwner);
  }
  @Post('templates') @HttpCode(200) create(@Req() req: ApiRequest, @Body() input: TemplateDto) {
    return this.service.createTemplate(req.terminalOwner, input);
  }
  @Get('templates/:id') getTemplate(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.service.getTemplate(req.terminalOwner, id);
  }
  @Put('templates/:id') update(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() input: TemplateDto,
  ) {
    return this.service.updateTemplate(req.terminalOwner, id, input);
  }
  @Patch('templates/:id/enabled') enabled(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() input: TemplateEnabledDto,
  ) {
    return this.service.setTemplateEnabled(req.terminalOwner, id, input.enabled);
  }
  @Delete('templates/:id') remove(@Req() req: ApiRequest, @Param('id') id: string) {
    this.service.deleteTemplate(req.terminalOwner, id);
    return { success: true };
  }
  @Post('templates/:id/test') @HttpCode(200) testTemplate(
    @Req() req: ApiRequest,
    @Param('id') id: string,
  ) {
    return this.service.testTemplate(req.terminalOwner, id);
  }
  @Get() get(@Req() req: ApiRequest) {
    return this.service.getSettings(req.terminalOwner);
  }
  @Put() save(@Req() req: ApiRequest, @Body() input: SettingsDto) {
    return this.service.saveSettings(req.terminalOwner, input);
  }
  @Post('test') @HttpCode(200) test(@Req() req: ApiRequest) {
    return this.service.enqueueTest(req.terminalOwner);
  }
  @Get('deliveries') deliveries(@Req() req: ApiRequest, @Query() query: DeliveryPageDto) {
    return this.service.deliveries(req.terminalOwner, query.page, query.pageSize, query);
  }
}
