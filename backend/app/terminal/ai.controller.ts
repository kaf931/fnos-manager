import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  Delete,
  HttpCode,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import {
  AiActionDto,
  AiMessageDto,
  AiSettingsDto,
  AiProviderDto,
  AiConnectionTestDto,
} from './ai.dto.js';
import { AiApplicationService } from './ai.service.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api')
export class AiController {
  constructor(@Inject(AiApplicationService) private readonly service: AiApplicationService) {}
  @Get('terminal/ai/attachments/:attachmentId/preview') previewImage(@Req() req: ApiRequest) {
    return this.service.attachments.preview(req.terminalOwner, req.params.attachmentId);
  }
  @Get('terminal/ai/settings') read(@Req() req: ApiRequest) {
    return this.service.readSettings(req.terminalOwner);
  }
  @HttpCode(200) @Post('terminal/ai/test') testConnection(@Body() body: AiConnectionTestDto) {
    return this.service.testConnection(body);
  }
  @Get('terminal/ai/models') models(@Req() req: ApiRequest) {
    return this.service.models(req.terminalOwner);
  }
  @Get('terminal/ai/providers') providers(@Req() req: ApiRequest) {
    return this.service.settings.listProviders(req.terminalOwner);
  }
  @Get('terminal/ai/providers/:providerId') provider(@Req() req: ApiRequest) {
    return this.service.settings.readProvider(req.terminalOwner, req.params.providerId);
  }
  @Post('terminal/ai/providers') addProvider(@Req() req: ApiRequest, @Body() body: AiProviderDto) {
    return this.service.settings.saveProvider(req.terminalOwner, body);
  }
  @Put('terminal/ai/providers/:providerId') updateProvider(
    @Req() req: ApiRequest,
    @Body() body: AiProviderDto,
  ) {
    return this.service.settings.saveProvider(req.terminalOwner, body, req.params.providerId);
  }
  @Delete('terminal/ai/providers/:providerId') deleteProvider(@Req() req: ApiRequest) {
    return this.service.settings.deleteProvider(req.terminalOwner, req.params.providerId);
  }
  @Get('terminal/ai/providers/:providerId/models') providerModels(@Req() req: ApiRequest) {
    return this.service.models(req.terminalOwner, req.params.providerId);
  }
  @Get('terminal/ai/history') history(@Req() req: ApiRequest) {
    return this.service.history.list(req.terminalOwner);
  }
  @Get('terminal/ai/history/:chatId') historyDetail(@Req() req: ApiRequest) {
    return this.service.readHistory(req.terminalOwner, req.params.chatId);
  }
  @Post('terminal/sessions/:id/ai/new') newChat(
    @Req() req: ApiRequest,
    @Body() _body: AiActionDto,
  ) {
    return this.service.conversations.newChat(req.terminalOwner, req.params.id);
  }
  @Post('terminal/sessions/:id/ai/history/:chatId/restore') restore(
    @Req() req: ApiRequest,
    @Body() _body: AiActionDto,
  ) {
    return this.service.conversations.restore(req.terminalOwner, req.params.id, req.params.chatId);
  }
  @Put('terminal/ai/settings') save(@Req() req: ApiRequest, @Body() body: AiSettingsDto) {
    return this.service.saveSettings(req.terminalOwner, body);
  }
  @Get('terminal/sessions/:id/ai/conversation') snapshot(@Req() req: ApiRequest) {
    return this.service.conversations.snapshot(req.terminalOwner, req.params.id);
  }
  @HttpCode(202) @Post('terminal/sessions/:id/ai/messages') async message(
    @Req() req: ApiRequest,
    @Body() body: AiMessageDto,
  ) {
    await this.service.message(req.terminalOwner, req.params.id, body);
    return { accepted: true };
  }
  @HttpCode(202) @Post('terminal/sessions/:id/ai/proposals/:proposalId/execute') execute(
    @Req() req: ApiRequest,
    @Body() _body: AiActionDto,
  ) {
    this.service.conversations.execute(req.terminalOwner, req.params.id, req.params.proposalId);
    return { accepted: true };
  }
  @HttpCode(202) @Post('terminal/sessions/:id/ai/proposals/:proposalId/reject') reject(
    @Req() req: ApiRequest,
    @Body() _body: AiActionDto,
  ) {
    this.service.conversations.reject(req.terminalOwner, req.params.id, req.params.proposalId);
    return { accepted: true };
  }
  @HttpCode(200) @Post('terminal/sessions/:id/ai/cancel') cancel(
    @Req() req: ApiRequest,
    @Body() _body: AiActionDto,
  ) {
    this.service.cancel(req.terminalOwner, req.params.id);
    return { cancelled: true };
  }
}
