# 结构与风格整理（2026-10-22）

本轮落实用户已批准的六项审查问题，保持产品功能、网关鉴权、接口响应、SQLite schema v8和现有数据不变。

1. 后端：控制器负责路由与HTTP，业务编排交给应用服务；普通JSON使用Nest标准返回，文件流保留Express响应；清理无效Store生命周期包装，存储服务显式管理关闭。
2. 前端：拆分文件管理大组件的对话框、展示与交互职责，保留会话/目录/异步响应有效性检查。
3. 样式：按组件集中公共工具栏和卡片规则，保留层叠行为、移动触摸区域、统一滚动条及主题变量。
4. 检查：分开浏览器/Node ESLint环境；为边界增加静态约束，前端纯逻辑逐步纳入类型检查，不能用全局放宽掩盖问题。
5. 文档：README同步NestJS/SQLite、凭据与快捷指令当前实际行为、打包部署、源码/生成产物边界。
6. 按官方文档复核并记录实测证据：Semi支持语义Token及局部CSS覆盖；Nest支持异步工厂Provider、生命周期钩子、标准与流响应两种模式。不把本项目目录/文件行数偏好声称为官方硬性规定。

验证：针对迁移职责和关闭流程的回归，现有全量测试、ESLint、TypeScript、Prettier、FPK构建；320/390px及桌面浏览器检查工具栏/卡片/独立入口。所有检查完成后用SSH停止依赖快捷应用及主应用、替换运行产物、恢复启动，核对版本、SQLite完整性/外键/行数和关键接口。应用中心登记版本不等于运行版本；禁止清空数据或使用install-local升级。

官方依据：
- https://docs.nestjs.com/providers
- https://docs.nestjs.com/controllers
- https://docs.nestjs.com/fundamentals/lifecycle-events
- https://docs.nestjs.com/techniques/validation
- https://semi.design/en-US/ecosystem/faq
- https://semi.design/en-US/basic/tokens
