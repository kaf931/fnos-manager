import { menuPages, type MenuPage } from '../../domain/icons.js';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class IconDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @IsIn(menuPages) menuPage?: MenuPage | null;
  @IsOptional() @IsIn(['iframe', 'url']) mode?: 'iframe' | 'url';
  @IsOptional() @IsString() @MaxLength(128) containerId?: string | null;
  @IsOptional() @IsString() @MaxLength(8 * 1024 * 1024) image?: string;
  @IsOptional() @IsString() @MaxLength(40) iconSource?: string;
}
export class DiscoverIconDto {
  @IsString() @MaxLength(2048) url!: string;
  @IsOptional() @IsString() @MaxLength(2048) iconUrl?: string;
}
