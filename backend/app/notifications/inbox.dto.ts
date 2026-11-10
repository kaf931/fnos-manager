import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { PageDto } from '../common/page.dto.js';
export class InboxPageDto extends PageDto {
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
