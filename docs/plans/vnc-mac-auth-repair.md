# Mac VNC 认证与状态展示修复

## 触发与根因

NAS 通过已配置的端口映射可读取 Mac RFB 003.889 握手。Mac 的认证列表把 Apple ARD（30）排在标准 VNC 密码（2）之前。noVNC 1.7 依服务器顺序选择认证，导致未填写用户名的密码连接误选 ARD；HTTP 页面缺少 Web Crypto，异步认证抛错后仍停留在等待状态。

## 实施

- 密码连接不选择需要用户名的 Apple ARD，其他安全类型继续由上游决定；填写用户名的账户连接要求 Web Crypto，不静默降级。
- noVNC 固定 1.7.0；唯一内部支持类型钩子集中在 web/vnc-client.ts，声明及注释记录版本约束，不改 node_modules、不替换浏览器加密实现。
- 30 秒握手期限覆盖 noVNC 建连与认证阶段，超时退出等待并释放会话，成功、断开、重连、卸载清理定时器，隔离旧连接回调。
- 提示改为远程画面中央覆盖层，公共加载图标与错误色；成功后移除，没有顶部独立行。

## 验证

先复现红灯，再验证认证策略、HTTPS 条件、状态层 DOM、认证失败、握手超时清理及旧回调隔离。隔离 RFB 夹具按 Mac 顺序宣告认证列表，真实 noVNC 密码认证成功显示画面。NAS 更新后继续验证真实 Mac 登录与画面。

## 官方依据

- https://github.com/novnc/noVNC/blob/v1.7.0/core/rfb.js
- https://github.com/novnc/noVNC/issues/1781
- https://github.com/novnc/noVNC/blob/v1.7.0/docs/API.md
