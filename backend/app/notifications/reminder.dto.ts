import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsOptional,
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
  @IsOptional() @IsString() @MaxLength(40) dueAt!: string | null;
  @IsIn(REMINDER_REPEATS) repeat!: ReminderRepeat;
  @IsArray()
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
