export const RDP_SECURITY_MODES = ['any', 'nla', 'tls', 'rdp'] as const;
export type RdpSecurity = (typeof RDP_SECURITY_MODES)[number];
export const RDP_CERTIFICATE_POLICIES = ['strict', 'tofu', 'ignore'] as const;
export type RdpCertificatePolicy = (typeof RDP_CERTIFICATE_POLICIES)[number];
export const RDP_SECURITY_LABELS: Record<RdpSecurity, string> = {
  any: '自动协商',
  nla: 'NLA',
  tls: 'TLS',
  rdp: 'RDP（旧版）',
};
export const RDP_CERTIFICATE_LABELS: Record<RdpCertificatePolicy, string> = {
  strict: '严格验证',
  tofu: '首次信任并记住',
  ignore: '忽略证书校验',
};
export interface RdpConnection {
  id: string;
  ownerUid: string;
  name: string;
  protocol: 'rdp';
  host: string;
  port: number;
  username: string;
  password: string;
  domain: string;
  security: RdpSecurity;
  certificatePolicy: RdpCertificatePolicy;
  folderId: string | null;
}
