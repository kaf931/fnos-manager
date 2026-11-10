import {
  IsArray,
  IsOptional,
  IsInt,
  Min,
  Max,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  ArrayMinSize,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  REMINDER_REPEATS,
  type ReminderInput,
  type ReminderRepeat,
} from '../../domain/reminders.js';
export class ReminderDto implements ReminderInput {
  @IsString() @MaxLength(80) name!: string;
  @IsString() @MaxLength(8000) content!: string;
  @IsString() @MaxLength(40) dueAt!: string | null;
  @IsIn(REMINDER_REPEATS) repeat!: ReminderRepeat;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  templateIds!: string[];
  @IsBoolean() enabled!: boolean;
}
export class ReminderCompleteDto {
  @IsBoolean() completed!: boolean;
}

export class ReminderBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  ids!: string[];
  @IsIn(['complete', 'pause', 'delete']) action!: 'complete' | 'pause' | 'delete';
}
