# 生产包空白页修复

用户反馈更新后页面空白。使用完整生产 dist 页面在浏览器中复现，控制台报错 `Cannot read properties of undefined (reading 'Component')`，位置在 ui-vendor 初始化阶段。

原因是 Vite 的 React 核心分包规则 `/\/(react|react-dom|scheduler)\//` 同时匹配了 `node_modules/@dnd-kit/react/`。拖拽库被误放入 react-vendor，依赖位于 ui-vendor 的 DOM 库；ui-vendor 中的 Semi 又依赖 react-vendor，导致 React 尚未初始化即被使用。

将规则限定到 `node_modules/react`、`node_modules/react-dom` 和 `node_modules/scheduler`，避免误匹配作用域包中的同名路径。保留拖拽动画功能。

## 验证与补充检查

- 新增 vendor-chunks 回归测试，覆盖核心 React、pnpm 嵌套路径以及 @dnd-kit/react、sortable、dom 的分包归属。将配置暂时恢复旧规则时测试失败，恢复修复后通过。
- 全量 1032 项测试通过，生产构建、类型检查与修改文件的 ESLint 通过。
- 直接使用新生成的完整生产页面进行浏览器启动检查，导航、页面错误提示和重试按钮正常渲染，不再在初始化时空白。本地静态服务器不提供业务 API，因此此页面的“请求失败”提示属于预期，不将它表述为 NAS 登录界面的完整业务验收。
- 此前只验证公共组件测试页，漏掉了生产分包后的整页启动，本次补上整包启动与分包归属检查。

## NAS 恢复

已通过 SSH 保留数据替换运行文件并启动，运行版本仍为 0.4.2，应用中心登记版本未改。

- 数据库备份：`/tmp/notification-center-pre-1794301888408.sqlite`。
- 运行文件备份：`/tmp/adb-runtime-backup.PLrvah`。
- 新生产页面引用的 JS、CSS 和图标文件均存在，React 核心包不再反向导入 ui-vendor。
- 本地和 NAS 的生产 HTML SHA256 均为 `aab04666f4ac6909545ea04684c989c5c79114044e8cc85e9d1d698771d1c792`。
- 运行版本与关键业务接口正常；原业务配置数量一致，模板及投递记录校验通过，原有 1 条提醒保留。数据库版本仍为 34，完整性正常，外键错误 0。
