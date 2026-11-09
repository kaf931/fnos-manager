# 0.2.48 规范复核及主题按钮清理

日期：2026-10-22。

复核前后端严格类型覆盖、前端React渲染所有权、公共组件/主题样式、Nest应用服务及DTO验证、SQLite存储约束和构建检查。未发现新的违反既定约束的问题。这是对当前代码和可验证范围的结论，不能表示所有场景零缺陷，也不存在框架颁发的“全项目完全合规”认证。

## 复核证据

- 前端109个业务TS/TSX文件全部参与strict；后端全部参与strict。前端旧JS、显式any、类型忽略及非法HTML写入审计通过。
- ESLint含前后端运行环境和控制器/仓库边界约束；Prettier全部通过。
- 357项测试全部通过，涵盖HTTP/SQLite、权限、DTO、生命周期及UI交互。
- 构建强制typecheck和静态宿主契约检查，原生FPK生成成功。
- 对照[Nest ValidationPipe](https://docs.nestjs.com/techniques/validation)检查全局transform、白名单和额外字段拒绝；[React DOM边界](https://react.dev/learn/manipulating-the-dom-with-refs)支持焦点及测量适配；[Semi Tokens](https://semi.design/en-US/basic/tokens)用于公共主题变量。

本次删除底部theme-toggle按钮、事件处理、无效CSS及生成契约条目，initPlatform不再接收仅供旧按钮使用的API/toast参数。浏览器确认底部仅保留系统设置，系统设置仍显示主题选择；飞牛主题事件及系统主题同步保留。

实体手机WebView键盘行为及全部第三方AI/远程SSH环境未在本轮穷举测试。构建存在Vite大chunk体积提示，这是性能优化事项，不是类型/构建失败。

部署验收详见backend-architecture.md的0.2.48记录。
