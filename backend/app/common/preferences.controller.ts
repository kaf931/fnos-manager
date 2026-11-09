import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { PreferencesService } from './preferences.service.js';
import { TerminalOwnerGuard } from './security.js';
import type { ApiRequest } from './types.js';
class PreferencesDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['classic', 'mist', 'teal', 'default'])
  palette?: 'classic' | 'mist' | 'teal' | 'default';
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['striped', 'solid'])
  terminalBackground?: 'striped' | 'solid';
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['system', 'light', 'dark']) theme?:
    'system' | 'light' | 'dark';
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() commandHints?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['icons', 'tasks', 'terminal', 'storage', 'wake'])
  defaultPage?: 'icons' | 'tasks' | 'terminal' | 'storage' | 'wake';
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() navigationMotion?: boolean;
}
@UseGuards(TerminalOwnerGuard)
@Controller('app/deskicons/api/preferences')
export class PreferencesController {
  constructor(@Inject(PreferencesService) private readonly service: PreferencesService) {}
  @Get() get(@Req() req: ApiRequest) {
    return this.service.get(req.terminalOwner);
  }
  @Put() save(@Req() req: ApiRequest, @Body() input: PreferencesDto) {
    return this.service.save(req.terminalOwner, input);
  }
}
