import {
  RDP_SECURITY_MODES,
  RDP_CERTIFICATE_POLICIES,
  type RdpSecurity,
  type RdpCertificatePolicy,
} from '../../domain/rdp.js';
import { IsString, IsIn, IsOptional, MaxLength, MinLength, IsInt, Min, Max } from 'class-validator';
export class RdpConnectionDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsIn(['rdp']) protocol!: 'rdp';
  @IsString() @MinLength(1) @MaxLength(253) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsString() @MinLength(1) @MaxLength(128) username!: string;
  @IsOptional() @IsIn(RDP_SECURITY_MODES) security?: RdpSecurity;
  @IsOptional() @IsIn(RDP_CERTIFICATE_POLICIES) certificatePolicy?: RdpCertificatePolicy;
  @IsOptional() @IsString() @MaxLength(253) domain?: string;
  @IsOptional() @IsString() @MaxLength(4096) password?: string;
  @IsOptional() @IsString() @MaxLength(80) folderId?: string | null;
}
export class RdpSessionDto {
  @IsString() @MaxLength(80) connectionId!: string;
  @IsOptional() @IsInt() @Min(320) @Max(3840) width?: number;
  @IsOptional() @IsInt() @Min(200) @Max(2160) height?: number;
}
export class RdpFolderDto {
  @IsOptional() @IsString() @MaxLength(80) folderId?: string | null;
}
