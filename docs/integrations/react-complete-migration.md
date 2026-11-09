# React 完整迁移实施计划

用户明确要求完成迁移，不再保留业务 DOM 控制器或 SurfaceHost/createSurface 过渡层。版本 0.3.1，保持功能、公共样式、接口及数据。

## 接口与边界
- 单入口 createRoot，App 管理导航、初始化、toast 和功能组件。
- 功能组件接受 `services: UiServices`（现有 contracts/shared.ts 的 api/toast），以及 `state: AppState`（需要时）。页面用 `active: boolean` 控制显示，保留连接会话状态。
- 公共 ReactDialog 接收 open/onClose/title/children/footer/className/id，通过 ref effect 调用原生 showModal/close，业务渲染和事件全在 JSX。
- confirmAction 允许通过公共对话服务调用，显示部分由 React 统一持有。禁止动态 createElement + createSurface 挂载。
- 三方终端、远程画布、编辑器实例可在 React effect/ref 内管理，浏览器 SDK、滚动条、下载、焦点、尺寸测量可命令式集成；不允许借此保存整套旧业务控制器。
- 删除替代后的旧代码和仅测试旧实现的模板契约，不通过重命名过渡层规避要求。

## 工作顺序与验收
- [x] 公共 React 入口、导航、对话框、图标页面及设置页。
- [x] 计划任务与网络唤醒受控页面/编辑器，删除旧 setup 控制器。
- [x] 存储页面及清理详情 React 管理，保留全部批量操作与安全边界。
- [x] 远程连接、工作区、AI 等面板 React 管理，第三方实例受 effect 生命周期约束。
- [x] 全仓旧入口检查、类型检查、针对并发/卸载/确认/选择上限回归，完整测试构建及浏览器验收。
- [x] SSH 保留数据部署并检查服务/数据库/接口，记录实际验证结果。

审查重点：取消后的异步结果不得重新打开界面；切换菜单不得断开 SSH；表单切换协议不得遗留密码；清理选择不超过服务端限制；独立入口首次不显示主导航。

## 完成与验收（2026-10-25）

业务页面的状态、事件和渲染已迁移到 React。删除 SurfaceHost/createSurface、旧页面 setup 控制器、旧模板生成脚本和兼容挂载入口；前端审计阻止这些实现重新引入。xterm、noVNC、CodeMirror 及飞牛 SDK、原生对话框、尺寸测量等仍通过 effect/ref 集成，它们属于浏览器或第三方 API 边界，不是旧业务渲染路径。

- 完整测试：719 项通过，0 失败；类型检查、ESLint、Prettier 检查及构建通过。
- 本地浏览器检查：导航、图标编辑窗口、计划任务和存储入口可正常显示；修正图标编辑窗口宽度与布局、页面加载后的滚动条观察注册时机。
- 通过 SSH 停止服务、替换 dist/server、启动，保留应用数据；未使用应用中心升级。
- 服务状态检查退出码 0；state、tasks、terminal/connections 接口均返回 200。
- SQLite integrity_check = ok，foreign_key_check 无异常，schema user_version = 22。
- NAS 与本地 dist/index.html SHA-256 一致：1b5e3463c4892e0b677a1d7be45a75b7176dd28f05c4fc633560340e9e67bc70。
- 实际运行版本 0.3.1；本次不修改应用中心登记元信息（此前登记为 0.2.52）。
- 验证边界：NAS 浏览器直达地址返回 invalid token，未进行登录后的全功能 UI 验收；未连接手机、未执行真实关机/重启或清理操作。

## 后续完整复查

本轮完整功能与界面检查、公共样式补齐和 NAS 验收见 [2026-10-25 全项目检查记录](full-project-audit-2026-10-25.md)，其中的最终构建哈希和验证结果取代本页早先部署记录。
