import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
export class ScheduleDto {
  @IsIn(['daily', 'weekly', 'interval', 'once']) kind!: string;
  @IsOptional() @IsString() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) time?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(10080) minutes?: number;
  @IsOptional() @IsString() @MaxLength(40) at?: string;
}
export class DeviceTargetDto {
  @IsString() @MaxLength(64) id!: string;
  @IsString() @MaxLength(64) connectionId!: string;
  @IsString() @MaxLength(253) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsString() @MaxLength(128) username!: string;
  @IsOptional() @IsIn(['linux', 'windows', 'macos']) system?: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}
export class TaskDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsIn([
    'device-wake',
    'device-reboot',
    'device-shutdown',
    'app',
    'docker',
    'reboot',
    'trash-clear',
    'log-clear',
    'cache-clear',
    'backup',
    'snapshot',
    'script',
  ])
  type!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() acknowledged?: boolean;
  @IsObject() @ValidateNested() @Type(() => ScheduleDto) schedule!: ScheduleDto;
  @IsOptional() @IsInt() @Min(0) @Max(2) retryCount?: number;
  @IsOptional() @IsIn(['skip', 'once']) missedPolicy?: string;
  @IsOptional() @IsInt() @Min(5) @Max(3600) timeoutSeconds?: number;
  @IsOptional() @IsString() @MaxLength(128) target?: string;
  @IsOptional() @IsIn(['start', 'stop', 'restart']) action?: string;
  @IsOptional() @IsString() @MaxLength(32768) script?: string;
  @IsOptional() @IsInt() @Min(-1) @Max(65535) level?: number;
  @IsOptional() @IsInt() @Min(-1) @Max(65535) module?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  deviceIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DeviceTargetDto)
  deviceTargets?: DeviceTargetDto[];
  @IsOptional() @IsString() @MaxLength(300) pendingReason?: string;
  @IsOptional() @IsBoolean() reviewedAfterRestore?: boolean;
  // Client read-only fields are accepted for existing edit requests, never trusted for ownership.
  @IsOptional() @IsString() @MaxLength(64) ownerUid?: string;
  @IsOptional() @IsString() @MaxLength(64) id?: string;
  @IsOptional() @IsString() @MaxLength(40) createdAt?: string;
  @IsOptional() @IsString() @MaxLength(40) updatedAt?: string;
  @IsOptional() @IsString() @MaxLength(40) nextRunAt?: string | null;
  @IsOptional() @IsBoolean() running?: boolean;
  @IsOptional() @IsObject() lastRun?: object | null;
}
export class ConfirmDto {
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) expectedRevision?: string;
  @IsOptional() @IsBoolean() confirmed?: boolean;
}
export class AuthorizeDto {
  @IsString() @MaxLength(2048) origin!: string;
  @IsOptional() @IsBoolean() fileStorage?: boolean;
}
export class ExchangeDto {
  @IsString() @MaxLength(4096) code!: string;
}
