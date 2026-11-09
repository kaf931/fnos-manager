import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class SkillPackagePreviewDto {
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @IsBoolean() official?: boolean;
}
export class SkillPackageCommitDto {
  @IsUUID() previewId!: string;
  @IsOptional() @IsUUID() skillId?: string;
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
}
export class SkillAuthorizationDto {
  @IsUUID() skillId!: string;
  @IsString() @MinLength(1) @MaxLength(2048) origin!: string;
  @IsBoolean() fileStorage!: boolean;
}
export class SkillAuthorizationCodeDto {
  @IsString() @MaxLength(4096) code!: string;
}
