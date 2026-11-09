import {
  StreamableFile,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TerminalOwnerGuard } from '../common/security.js';
import type { ApiRequest } from '../common/types.js';
import { AiApplicationService } from './ai.service.js';
import { AiSkillDto, AiSkillEnabledDto } from './ai.dto.js';
import {
  SkillPackagePreviewDto,
  SkillPackageCommitDto,
  SkillAuthorizationDto,
  SkillAuthorizationCodeDto,
} from './ai-skills.dto.js';
import { DomainError } from '../../errors.js';
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api')
export class AiSkillsController {
  constructor(@Inject(AiApplicationService) private service: AiApplicationService) {}
  @Get('terminal/ai/skills') skills(@Req() r: ApiRequest) {
    return this.service.skills.list(r.terminalOwner);
  }
  @Get('terminal/ai/skills/:skillId') skill(@Req() r: ApiRequest) {
    return this.service.skills.get(r.terminalOwner, r.params.skillId);
  }
  @Post('terminal/ai/skills') add(@Req() r: ApiRequest, @Body() b: AiSkillDto) {
    return this.service.skills.save(r.terminalOwner, b);
  }
  @Put('terminal/ai/skills/:skillId') update(@Req() r: ApiRequest, @Body() b: AiSkillDto) {
    return this.service.skills.save(r.terminalOwner, b, r.params.skillId);
  }
  @Put('terminal/ai/skills/:skillId/enabled') enable(
    @Req() r: ApiRequest,
    @Body() b: AiSkillEnabledDto,
  ) {
    this.service.invalidateSkill(r.terminalOwner, r.params.skillId);
    return this.service.skills.setEnabled(r.terminalOwner, r.params.skillId, b.enabled);
  }
  @Delete('terminal/ai/skills/:skillId') remove(@Req() r: ApiRequest) {
    this.service.invalidateSkill(r.terminalOwner, r.params.skillId);
    const result = this.service.skills.remove(r.terminalOwner, r.params.skillId);
    this.service.packages.sweep();
    return result;
  }
  @Post('terminal/ai/skill-packages/upload') upload(@Req() r: ApiRequest) {
    if (!Buffer.isBuffer(r.body)) throw new DomainError('请上传 ZIP 文件');
    return this.service.packages.preview(
      r.terminalOwner,
      { zip: r.body },
      AbortSignal.timeout(20000),
    );
  }
  @Post('terminal/ai/skill-packages/preview') preview(
    @Req() r: ApiRequest,
    @Body() b: SkillPackagePreviewDto,
  ) {
    return this.service.packages.preview(
      r.terminalOwner,
      { url: b.url, ...(b.official ? { official: true } : {}) },
      AbortSignal.timeout(20000),
    );
  }
  @Post('terminal/ai/skill-packages/commit') commit(
    @Req() r: ApiRequest,
    @Body() b: SkillPackageCommitDto,
  ) {
    if (!!b.skillId !== !!b.expectedRevision) throw new DomainError('替换技能需指定修订号');
    if (b.skillId) this.service.invalidateSkill(r.terminalOwner, b.skillId);
    return this.service.packages.commit(
      r.terminalOwner,
      b.previewId,
      b.skillId ? { skillId: b.skillId, expectedRevision: b.expectedRevision! } : undefined,
    );
  }
  @Get('terminal/ai/skills/:skillId/resources') resources(@Req() r: ApiRequest) {
    return this.service.packages.manifest(r.terminalOwner, r.params.skillId);
  }
  @Get('terminal/ai/skills/:skillId/resource/file') download(@Req() r: ApiRequest) {
    const m = this.service.packages.manifest(r.terminalOwner, r.params.skillId);
    if (typeof r.query.path !== 'string') throw new DomainError('请选择资源');
    const file = this.service.packages.download(r.terminalOwner, m.ref, r.query.path);
    return new StreamableFile(file.bytes, {
      type: 'application/octet-stream',
      disposition: "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      length: file.bytes.length,
    });
  }
  @Get('terminal/ai/skills/:skillId/resource') resource(@Req() r: ApiRequest) {
    const m = this.service.packages.manifest(r.terminalOwner, r.params.skillId);
    if (typeof r.query.path !== 'string') throw new DomainError('请选择资源');
    return this.service.packages.read(
      r.terminalOwner,
      m.ref,
      r.query.path,
      Number(r.query.offset || 0),
    );
  }
  @Post('terminal/sessions/:id/ai/skill-authorizations') authorize(
    @Req() r: ApiRequest,
    @Body() b: SkillAuthorizationDto,
  ) {
    const m = this.service.packages.manifest(r.terminalOwner, b.skillId);
    return this.service.skillAuth.begin(
      r.terminalOwner,
      r.params.id,
      m.ref,
      b.origin,
      b.fileStorage,
    );
  }
  @Post('terminal/sessions/:id/ai/skill-authorizations/:authorizationId/exchange') exchange(
    @Req() r: ApiRequest,
    @Body() b: SkillAuthorizationCodeDto,
  ) {
    return this.service.skillAuth.exchange(
      r.terminalOwner,
      r.params.id,
      r.params.authorizationId,
      b.code,
    );
  }
  @Get('terminal/sessions/:id/ai/skill-authorizations/:authorizationId') status(
    @Req() r: ApiRequest,
  ) {
    return this.service.skillAuth.status(r.terminalOwner, r.params.id, r.params.authorizationId);
  }
  @Delete('terminal/sessions/:id/ai/skill-authorizations/:authorizationId') disconnect(
    @Req() r: ApiRequest,
  ) {
    return this.service.skillAuth.disconnect(
      r.terminalOwner,
      r.params.id,
      r.params.authorizationId,
    );
  }
}
