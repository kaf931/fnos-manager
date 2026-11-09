import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';
export class AdbConnectionDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsIn(['adb']) protocol!: 'adb';
  @IsOptional() @IsString() @MaxLength(253) host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['network', 'usb']) deviceType?: 'network' | 'usb';
  @IsOptional() @IsIn(['tcp', 'usb']) transport?: 'tcp' | 'usb';
  @IsOptional() @IsString() @MaxLength(128) serial?: string;
  @IsOptional() @IsString() @MaxLength(80) folderId?: string | null;
}
export class AdbSessionDto {
  @IsString() @MaxLength(80) connectionId!: string;
}
export class AdbFolderDto {
  @IsOptional() @IsString() @MaxLength(80) folderId?: string | null;
}
export class AdbPairDto {
  @IsString() @MaxLength(253) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class AdbShellDto {
  @IsString() @MinLength(1) @MaxLength(65536) command!: string;
}
export class AdbRenameDto {
  @IsString() @MaxLength(4096) path!: string;
  @IsString() @MaxLength(4096) target!: string;
}
