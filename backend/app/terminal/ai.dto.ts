import { Type } from 'class-transformer';
import { AI_ATTACHMENT_LIMITS } from '../../domain/ai-attachments.js';
import { AI_PROTOCOLS, type AiProtocol } from '../../domain/ai.js';
import {
  ArrayMaxSize,
  IsArray,
  ValidateNested,
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateIf,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
export class AiSettingsDto {
  @IsString() @MinLength(1) @MaxLength(2048) baseUrl!: string;
  @IsString() @MinLength(1) @MaxLength(200) model!: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(8192)
  apiKey?: string;
}
export class AiProviderDto extends AiSettingsDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsIn(AI_PROTOCOLS) protocol!: AiProtocol;
}
export class AiAttachmentDto {
  @IsString() @MinLength(1) @MaxLength(180) name!: string;
  @IsIn(['text', 'image', 'archive']) kind!: 'text' | 'image' | 'archive';
  @IsString() @MaxLength(80) mimeType!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(Math.ceil(AI_ATTACHMENT_LIMITS.archive / 3) * 4)
  data!: string;
}
export class AiMessageDto {
  @IsString() @MaxLength(16384) text!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AI_ATTACHMENT_LIMITS.count)
  @ValidateNested({ each: true })
  @Type(() => AiAttachmentDto)
  attachments?: AiAttachmentDto[];
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) model?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) providerId?: string;
  @IsOptional() @IsIn(['review', 'silent']) executionMode?: 'review' | 'silent';
}
export class AiActionDto {
  @IsBoolean() @Equals(true) confirmed!: boolean;
}

export class AiConnectionTestDto {
  @IsString() @MinLength(1) @MaxLength(2048) baseUrl!: string;
  @IsIn(AI_PROTOCOLS) protocol!: AiProtocol;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(8192)
  apiKey?: string;
}

export class AiSkillDto {
  @IsString() @MinLength(1) @MaxLength(65536) document!: string;
  @IsBoolean() enabled!: boolean;
}
export class AiSkillEnabledDto {
  @IsBoolean() enabled!: boolean;
}
