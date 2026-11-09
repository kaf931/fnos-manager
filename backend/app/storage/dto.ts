import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
export class PathDto {
  @IsString() @MaxLength(4096) path!: string;
}
export class ScanDto extends PathDto {
  @IsIn(['space', 'duplicates']) mode!: string;
}
export class DeleteHistoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ids!: string[];
  @IsBoolean() confirmed!: boolean;
}
export class DuplicateItemDto {
  @IsString() @MaxLength(4096) path!: string;
  @IsString() @MaxLength(4096) keep!: string;
}
export class DuplicateActionDto {
  @IsIn(['move', 'delete']) action!: string;
  @IsBoolean() confirmed!: boolean;
  @IsOptional() @IsString() @MaxLength(4096) destination?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DuplicateItemDto)
  items!: DuplicateItemDto[];
}
export class RenameRulesDto {
  @IsOptional() @IsIn(['rules', 'unified']) mode?: string;
  @IsOptional() @IsString() @MaxLength(120) find?: string;
  @IsOptional() @IsString() @MaxLength(120) replace?: string;
  @IsOptional() @IsString() @MaxLength(120) prefix?: string;
  @IsOptional() @IsString() @MaxLength(120) suffix?: string;
  @IsOptional() @IsString() @MaxLength(120) baseName?: string;
  @IsOptional() @IsBoolean() number?: boolean;
  @IsOptional() @IsBoolean() keepExtension?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999999) start?: number;
  @IsOptional() @IsInt() @Min(1) @Max(6) pad?: number;
}
export class RenamePreviewDto extends PathDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  names!: string[];
  @IsOptional() @IsObject() @ValidateNested() @Type(() => RenameRulesDto) rules?: RenameRulesDto;
}
export class ScanEntriesQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 10;
  @IsIn(['name', 'size', 'modifiedAt']) sort: 'name' | 'size' | 'modifiedAt' = 'size';
  @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'desc';
  @IsIn(['catalog', 'largestFiles', 'topDirectories', 'extensions']) collection:
    'catalog' | 'largestFiles' | 'topDirectories' | 'extensions' = 'catalog';
  @IsOptional() @IsString() @MaxLength(255) search?: string;
}

export class HistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 10;
}
export class ScanHistoryQueryDto extends HistoryQueryDto {
  @IsOptional() @IsIn(['space', 'duplicates']) mode?: 'space' | 'duplicates';
}

export class AiAttachmentQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(180) search?: string;
  @IsOptional() @IsIn(['all', 'text', 'image', 'archive']) kind?:
    'all' | 'text' | 'image' | 'archive';
  @IsOptional() @Type(() => Number) @IsIn([0, 7, 30, 90]) olderThanDays?: number;
}

export class ScanComparisonQueryDto {
  @IsString() @MaxLength(64) before!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 20;
  @IsIn(['all', 'added', 'deleted', 'size', 'directory', 'unconfirmed']) kind = 'all';
}
