import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DeviceTargetDto } from '../tasks/dto.js';
export class WakeDeviceDto {
  @IsOptional() @IsString() @MaxLength(15) ip?: string;
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsString() @MaxLength(32) mac!: string;
  @IsString() @MaxLength(15) address!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsString() @MaxLength(64) connectionId?: string | null;
  @IsOptional() @IsIn(['linux', 'windows', 'macos']) system?: string;
  @IsOptional() @IsString() @MaxLength(64) id?: string;
  @IsOptional() @IsString() @MaxLength(40) updatedAt?: string;
}
export class WakeBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
}
export class PowerBatchDto extends WakeBatchDto {
  @IsIn(['reboot', 'shutdown']) action!: string;
  @IsBoolean() confirmed!: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DeviceTargetDto)
  targets?: DeviceTargetDto[];
}
