import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { PageDto } from '../common/page.dto.js';
export class InboxPageDto extends PageDto {
  @IsString() @MaxLength(200) q = '';
  @IsIn(['all', 'unread']) filter: 'all' | 'unread' = 'all';
}
export class ReadInboxDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  ids!: string[];
}

export class DeliveryPageDto extends PageDto {
  @IsOptional() @IsString() @MaxLength(80) templateId?: string;
  @IsOptional() @IsString() @MaxLength(80) reminderId?: string;
}
