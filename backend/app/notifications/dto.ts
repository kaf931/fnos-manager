import {
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  IsObject,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import {
  NOTIFICATION_CHANNELS,
  type NotificationSettingsInput,
} from '../../domain/notifications.js';
export class SettingsDto implements NotificationSettingsInput {
  @IsOptional()
  @IsIn(NOTIFICATION_CHANNELS)
  channel?: NotificationSettingsInput['channel'];
  @IsOptional() @IsObject() headers?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(8000) template?: string;
  @IsOptional() @IsString() @MaxLength(4096) signingSecret?: string;
  @IsOptional() @IsString() @MaxLength(253) smtpHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsIn(['tls', 'starttls', 'none']) smtpSecurity?: 'tls' | 'starttls' | 'none';
  @IsOptional() @IsString() @MaxLength(320) smtpUser?: string;
  @IsOptional() @IsString() @MaxLength(320) smtpFrom?: string;
  @IsOptional() @IsString() @MaxLength(2048) smtpTo?: string;
  @IsOptional() @IsString() @MaxLength(200) smtpSubject?: string;
  @IsBoolean() enabled!: boolean;
  @IsString() @MaxLength(2048) url!: string;
  @IsString() @MaxLength(4096) token!: string;
  @IsIn(['errors', 'all']) condition!: 'errors' | 'all';
  @IsBoolean() scanFailures!: boolean;
}

export class TemplateDto extends SettingsDto {
  @IsString() @MaxLength(80) name!: string;
}
export class TemplateEnabledDto {
  @IsBoolean() enabled!: boolean;
}
