import {
  IsBoolean,
  Matches,
  IsString,
  IsIn,
  IsOptional,
  MaxLength,
  MinLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
export class VncConnectionDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsIn(['vnc']) protocol!: 'vnc';
  @IsString() @MinLength(1) @MaxLength(253) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsOptional() @IsString() @MaxLength(128) username?: string;
  @IsOptional() @IsString() @MaxLength(4096) password?: string;
  @IsOptional() @IsString() @MaxLength(80) folderId?: string | null;
}
export class VncSessionDto {
  @IsString() @MaxLength(80) connectionId!: string;
}
export class VncFolderDto {
  @IsOptional() @IsString() @MaxLength(80) folderId?: string | null;
}

export class VncSettingsDto {
  @IsBoolean() shared!: boolean;
  @IsBoolean() viewOnly!: boolean;
  @IsBoolean() clipViewport!: boolean;
  @IsIn(['off', 'scale', 'remote']) scaleMode!: 'off' | 'scale' | 'remote';
  @IsInt() @Min(0) @Max(9) qualityLevel!: number;
  @IsInt() @Min(0) @Max(9) compressionLevel!: number;
  @IsIn(['local', 'remote']) cursorMode!: 'local' | 'remote';
  @IsBoolean() showDotCursor!: boolean;
  @IsBoolean() autoReconnect!: boolean;
  @IsInt() @Min(1000) @Max(60000) reconnectDelay!: number;
  @IsString() @MaxLength(250) @Matches(/^[^\u0000-\u001f\u007f-\u009f]*$/u) repeaterId!: string;
  @IsIn(['error', 'warn', 'info', 'debug']) logging!: 'error' | 'warn' | 'info' | 'debug';
}
