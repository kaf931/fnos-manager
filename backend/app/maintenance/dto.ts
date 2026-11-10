import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import {
  cleanupKinds,
  maintenanceDetailKinds,
  batchRecordKinds,
} from '../../domain/maintenance.js';
import type {
  CleanupKind,
  HistoryLimits,
  MaintenanceDetailKind,
  BatchRecordKind,
} from '../../domain/maintenance.js';
export class HistoryLimitsDto implements HistoryLimits {
  @IsInt() @Min(1) @Max(10000) scans!: number;
  @IsInt() @Min(1) @Max(10000) renames!: number;
  @IsInt() @Min(1) @Max(10000) taskRuns!: number;
  @IsInt() @Min(1) @Max(10000) operations!: number;
  @IsInt() @Min(1) @Max(10000) deliveries!: number;
  @IsInt() @Min(1) @Max(10000) appMessages!: number;
  @IsInt() @Min(1) @Max(10000) completedReminders!: number;
  @IsInt() @Min(1) @Max(10000) restoreReceipts!: number;
  @IsInt() @Min(1) @Max(100) serviceLogMiB!: number;
}
export class CleanupDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(cleanupKinds.length)
  @ArrayUnique()
  @IsIn(cleanupKinds, { each: true })
  kinds!: CleanupKind[];
  @IsBoolean() confirmed!: boolean;
}

export class MaintenanceKindDto {
  @IsIn(maintenanceDetailKinds) kind!: MaintenanceDetailKind;
}
export class MaintenanceDetailDto extends MaintenanceKindDto {
  @IsString() @MaxLength(128) id!: string;
}
export class MaintenancePageDto {
  @IsInt() @Min(1) @Max(1000000) @Type(() => Number) page = 1;
  @IsInt() @Min(1) @Max(100) @Type(() => Number) pageSize = 10;
}

export class BatchKindDto {
  @IsIn(batchRecordKinds) kind!: BatchRecordKind;
}
export class DeleteRecordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  ids!: string[];
  @IsBoolean() confirmed!: boolean;
}
