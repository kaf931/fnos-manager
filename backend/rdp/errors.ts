import { RDP_SECURITY_LABELS, RDP_CERTIFICATE_LABELS, type RdpConnection } from '../domain/rdp.js';
/** Guacamole protocol errors are distinct from native Windows/FreeRDP error codes. */
export function rdpEngineError(
  detail: string | undefined,
  status: string | undefined,
  password = '',
  policy?: Pick<RdpConnection, 'security' | 'certificatePolicy'>,
) {
  const code =
    status && /^\d{1,5}$/.test(status) && Number(status) <= 65535 ? String(Number(status)) : '512';
  let original = (detail || '').replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (password) original = original.split(password).join('[已隐藏]');
  original = original.slice(0, 500).trim();
  let reason = '远端或 RDP 引擎返回错误，请结合引擎原文排查';
  if (/SSL\/TLS|certificate|TLS handshake/i.test(original))
    reason =
      'TLS 连接失败，请检查证书信任、系统时间及 TLS 协议兼容性；当前证书策略：' +
      (policy ? RDP_CERTIFICATE_LABELS[policy.certificatePolicy] : '严格验证');
  else if (/DNS lookup|hostname resolution|name not found/i.test(original))
    reason = '主机名解析失败，请检查目标地址及 NAS 的 DNS 配置';
  else if (/Security negotiation failed/i.test(original))
    reason =
      '安全协商失败，请检查 Windows 是否支持当前安全模式：' +
      (policy ? RDP_SECURITY_LABELS[policy.security] : 'NLA');
  else if (/Authentication fail|invalid credentials|wrong password/i.test(original))
    reason = '身份认证失败，请检查用户名、密码及域名';
  else if (/Access denied|Insufficient privileges|account locked|account disabled/i.test(original))
    reason = '目标拒绝此账号访问，请检查账号锁定、禁用及远程桌面登录权限';
  else if (/Credentials expired/i.test(original))
    reason = '登录凭据已过期，请先在 Windows 更新密码或处理账号到期状态';
  else if (/Disconnected by other connection/i.test(original))
    reason = '会话被其他连接替代，请检查是否有另一客户端登录同一账号';
  else if (/Server refused connection/i.test(original))
    reason = '目标拒绝连接，请检查远程桌面服务、端口及安全模式';
  else if (/Connection failed|server unreachable/i.test(original))
    reason = '目标连接未成功，请检查 NAS 到目标的网络、端口与远程桌面服务';
  else if (code === '519')
    reason = '无法建立目标 RDP 连接；此状态可能涉及网络、名称解析或 TLS，请结合引擎原文判断';
  return {
    code,
    message: `RDP 连接失败（状态 ${code}）：${reason}${original ? `。引擎原文：${original}` : '；引擎未提供具体原因'}`,
  };
}
