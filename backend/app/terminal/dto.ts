import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
export class CredentialsDto {
  @IsOptional() @IsString() @MaxLength(4096) password?: string;
  @IsOptional() @IsString() @MaxLength(65536) privateKey?: string;
  @IsOptional() @IsString() @MaxLength(4096) passphrase?: string;
}
export class ConnectionDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsIn(['local', 'remote']) kind!: string;
  @IsOptional() @IsString() @MaxLength(253) host?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsString() @MinLength(1) @MaxLength(128) username!: string;
  @IsOptional() @IsIn(['password', 'privateKey']) authMethod?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CredentialsDto)
  credentials?: CredentialsDto;
  @IsOptional() @IsString() @MaxLength(64) folderId?: string | null;
  @IsOptional() @IsString() @MaxLength(64) id?: string;
  @IsOptional() @IsString() @MaxLength(64) ownerUid?: string;
  @IsOptional() @IsString() @MaxLength(40) createdAt?: string;
  @IsOptional() @IsString() @MaxLength(40) updatedAt?: string;
  @IsOptional() @IsBoolean() hasCredentials?: boolean;
}
export class FolderDto {
  @IsOptional() @IsString() @MaxLength(64) folderId?: string | null;
}
export class WorkspaceDto {
  @IsOptional() @IsIn(['folder', 'command']) kind?: string;
  @IsOptional() @IsIn(['assets', 'commands']) scope?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(16384) content?: string;
  @IsOptional() @IsString() @MaxLength(64) parentId?: string | null;
}
export class SessionDto {
  @IsString() @MaxLength(64) connectionId!: string;
}
export class FileDto {
  @IsOptional() @IsString() @MaxLength(4096) path?: string;
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(255) newName?: string;
}
export class PermissionDto extends FileDto {
  @IsInt() @Min(0) @Max(4095) mode!: number;
}
export class ArchiveDto extends FileDto {
  @IsOptional() @IsString() @MaxLength(255) outputName?: string;
  @IsOptional() @IsIn(['zip', 'tar', 'tar.gz', 'tar.xz', 'tgz', 'gz', 'xz', '7z']) format?: string;
}

export class CatalogCommandDto {
  @IsString() @MinLength(1) @MaxLength(300) @Matches(/^[^\x00-\x1f\x7f]+$/) command!: string;
  @IsString() @MinLength(1) @MaxLength(300) description!: string;
  @IsString() @MinLength(1) @MaxLength(40) category!: string;
}

export class TextFileDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() backup?: boolean;
  @IsString() @MaxLength(4096) path!: string;
  @IsString() @MaxLength(10 * 1024 * 1024) content!: string;
  @IsIn(['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'gbk', 'gb18030']) encoding!: string;
  @IsBoolean() bom!: boolean;
  @IsString() @Matches(/^[a-f0-9]{64}$/) revision!: string;
}
