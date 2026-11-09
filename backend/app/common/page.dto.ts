import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
}
