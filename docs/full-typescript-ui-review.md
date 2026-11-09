# 全量类型与界面实现统一

日期：2026-10-22。发行版本：0.2.47；SQLite schema v8，25 张业务表保持不变。

## 实现范围

前端 109 个 TypeScript/TSX 源文件全部纳入 strict 检查，allowJs=false，不按功能排除文件。原业务 JavaScript 源码已移除。后端继续使用 NestJS/TypeScript strict；Node 构建脚本与测试保留 JavaScript，分别受 ESLint 和行为测试约束。

API 客户端默认返回 unknown；会话、AI、命令、任务、唤醒和存储数据使用显式领域契约。原生页面元素类型从静态 HTML 自动生成，检查会阻止页面与契约漂移。Semi 选择器、表单、表格、弹层采用公开组件类型，明确单选值和日期回调类型。

动态卡片、列表、树、标签、弹窗内容、状态图标和监控摘要统一由 React 管理；不再在同一动态子树混用 HTML 拼接。静态外壳、焦点、滚动测量、文件输入、xterm 和原生 dialog 仍通过有类型的浏览器适配层接入。Markdown 的 HTML 消毒使用隔离模板，不作为业务 UI 模板。

## 自动防回退

- typecheck:web 先核对生成的页面契约，再执行全量 AST 审计和 TypeScript strict。
- 审计禁止前端 JS 残留、显式 any、类型忽略注释、双重 unknown 断言和动态 HTML 写入；消毒模板为唯一明确例外。
- 负向编译测试验证错误协议、会话、命令、HTTP 方法、选择器值和未收窄 API 返回值无法通过检查。
- 测试将 TS/TSX 编译到临时 .web-test，不在 web 保留旧实现；构建和打包均强制类型检查。

## 修复的实际问题

1. 批量改名 DTO 上限与前端/引擎统一为 500；覆盖 201、500 成功及 501 拒绝。
2. 重复文件操作仅提交 DTO 允许的 keep/path，不发送派生 size 字段。
3. 旧 Docker 图标预取响应不再覆盖新一轮应用加载状态。
4. SSH 认证图标由组件直接渲染，避免延迟弹窗遗漏图标。
5. 工作区关闭先关闭连接/发布状态，再销毁 React 根；延迟传输完成和重复销毁均有测试。
6. 确认弹窗等待操作期间禁止重复提交，失败后可重试，关闭后正确清理。

## 验证

357 项测试全部通过；全前后端类型检查、109 文件 AST 审计、ESLint、Prettier 和原生 FPK 构建通过。浏览器检查桌面及 320/390px 下卡片、底部面板、更多导航、存储记录、SSH 编辑和 Semi 时间选择器，复用现有公共样式。实体手机 WebView 的键盘行为不能由桌面浏览器验收替代。

对照 [React DOM 边界](https://react.dev/learn/manipulating-the-dom-with-refs)、[TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html) 和 [NestJS ValidationPipe](https://docs.nestjs.com/techniques/validation) 核查：类型检查不替代运行时验证，浏览器焦点/测量保留显式 DOM 边界，服务端继续执行 DTO 白名单及管理员权限检查。

部署结果见 backend-architecture.md 的 0.2.47 记录。
