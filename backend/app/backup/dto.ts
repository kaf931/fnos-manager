import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BACKUP_MODULES, type BackupModule, type BackupDecision } from '../../domain/backup.js';
export class ExportBackupDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsIn(BACKUP_MODULES, { each: true })
  modules!: BackupModule[];
  @IsBoolean() includeCredentials!: boolean;
}
export class PreviewBackupDto {
  @IsObject() backup!: Record<string, unknown>;
}
export class BackupDecisionDto implements BackupDecision {
  @IsString() @MaxLength(100) key!: string;
  @IsIn(['skip', 'import', 'map']) action!: 'skip' | 'import' | 'map';
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(64) targetId?: string;
}
export class RestoreBackupDto {
  @IsString() @MaxLength(128) token!: string;
  @IsString() @MaxLength(80) requestId!: string;
  @IsArray()
  @ArrayMaxSize(4000)
  @ValidateNested({ each: true })
  @Type(() => BackupDecisionDto)
  decisions!: BackupDecisionDto[];
}
