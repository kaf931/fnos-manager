> 状态说明（2026-10-25）：本文下方前端收敛结果为过渡阶段记录，已由 [React 完整迁移实施与验收](react-complete-migration.md) 取代。当前已删除 SurfaceHost、render-surface、shell 模板与旧业务控制器，统一由 App 的单一 React 根管理。

# 框架实现统一（2026-10-25）

用户已授权移除并存实现和旧代码，并修复复查问题。保持业务行为、NAS 数据及版本 0.3.1。

## 执行顺序
1. 公共批量选择匹配 200 条服务端上限；原生弹窗统一名称、关闭和焦点行为。
2. 分页参数统一 DTO；后端服务依赖改为明确 Provider 注入，清理服务定位器和重复实例管理。
3. 前端将静态业务模板转换为功能组件；统一 React 入口和区域渲染、错误边界，删除旧多根挂载路径。功能目录归类并更新构建、静态契约和测试引用。
4. 核查旧入口、旧 CSS、旧引用残留，运行完整测试、类型/契约、Lint、格式与构建。
5. SSH 停止、替换运行文件、启动，验证关键接口、数据库和真实界面；不清空数据、不通过应用中心更新。

## 验收重点
- 移动端加载超过 200 条时全选、单选和取消选择均与接口限制一致。
- 弹窗名称随新增/编辑变化；异常区域可重试，其他区域不受影响。
- 业务入口和 UI 契约可静态验证，独立桌面入口不闪现主导航。
- 服务初始化失败、调度启动和有序关闭行为不退化。
- 不仅搬文件或包装旧实现；记录仍保留的边界与必要原因。

## 后端收敛结果

- 操作记录与投递记录统一使用 `PageDto`，操作筛选扩展为 `OperationPageDto`；通过 Nest ValidationPipe 转换数字和拒绝未知键、重复键、非法枚举。Repository 继续保留安全整数及分页乘积检查，供非 HTTP 调用防御使用。
- `CommonModule` 的 Provider 工厂创建唯一共享 `DatabaseService` 与 `OperationService`，恢复操作记录后才交付依赖它的服务。Icons、Terminal、AI、Storage、Wake、Tasks 的工厂显式声明数据库及审计依赖。
- 移除 `operationsFor` WeakMap 服务定位器。Nest 入口向重命名、设备电源操作传递同一审计 Provider；独立使用领域类时可显式提供审计服务，否则按已有数据库创建无状态审计服务，不维护全局隐式缓存。
- `Resources` 仅保留私有生命周期登记、启动调度与有序关闭。Maintenance 明确注入 Storage；WebSocket attach 从 Nest 取得 Terminal / VNC Provider。删除数据库自身的 Nest destroy hook，避免与 Resources 并行关闭或重复调用。Resources 保留“先停止生产者、排空 worker、最后关闭数据库”及初始化失败时的清理入口。
- 保留领域对象、Repository 的显式构造：这些对象由已声明依赖的功能工厂拥有，并不另建容器或服务定位器。SQLite repository 的事务、迁移、批量 SQL 和所有权约束继续沿用，没有为形式统一新增 ORM。
- 验证：服务端类型检查、后端构建及后端 ESLint 通过；`backend-application`、`nest-framework`、`operations`、`notifications` 共 40 项测试通过。新增真实 Nest 回归测试确认共享审计实例、异步 worker 排空前数据库仍可读取、重复 close 只关闭一次数据库，初始化失败时关闭已登记 transport 和数据库且不启动调度器，以及两类 HTTP 分页默认值、重复/非法查询值和分页乘积溢出检查。

## 前端收敛结果

- `web/index.html` 只保留文档元信息及应用挂载点；业务模板迁入 `app-shell.tsx` 与 `features/*/shell.tsx`，删除旧静态模板、终端实例模板、首次绘制修补模块及其 Vite 注入。
- 生产代码只在 `ui/render-surface.tsx` 创建一个 React 根。原独立根改为同一应用树内的受控区域或 Portal；React 已拥有的区域不再嵌套创建根。公共错误边界支持局部失败后重试。
- 图标随组件首次渲染，删除启动后的全页面图标补绘。UI 契约和测试模板由同一 React shell 生成，不保留第二份业务 HTML。
- 保留现有业务控制器及 xterm/noVNC/CodeMirror 的命令式集成边界；这些仍有 DOM 事件、焦点和第三方实例操作，并非宣称所有业务代码已重写为 Hooks。公共 SurfaceHost 负责其 React 内容所有权，没有继续保留旧多根路径。
- 公共批量选择限制为 200 条；原生弹窗统一 aria-labelledby；移动编辑器节点移除时释放遮罩状态。

## 验证与 NAS 更新

2026-10-25：全量 709 项测试通过，另新增 2 项区域所有权/错误隔离测试通过；TypeScript、前端契约、ESLint、Prettier、生产构建通过。Vite 仍提示编辑器及 Semi UI vendor chunk 大于 500 kB，属于现有依赖分包体积提示，不表示构建失败。

通过 SSH 停止服务，替换 `dist` 与编译后的 `server`，再启动服务；保留应用数据库、附件与配置，不经过应用中心，不执行卸载。运行版本仍为 0.3.1，应用中心登记版本仍为 0.2.52。

- 服务状态正常，`state`、`tasks`、`terminal/connections` 接口均 HTTP 200。
- SQLite `integrity_check=ok`，外键异常 0，schema version 22。
- NAS 与本地 `dist/index.html` SHA256 一致：`a327cec39b7cb7eeb85fe4d4591d01786bcc7034f020f0ab5dded0ec444f0a7a`。
- NAS 浏览器验收：桌面图标新增弹窗、计划任务、存储入口/应用清理、扫描详情、远程连接新增弹窗正常；390px 小屏记录为公共单行列表，选中框位于右侧。
- 本次没有执行清理、任务运行或修改用户配置；没有连接手机。现有 FPK 未在本次重新打包，安装包需要后续重新生成才包含本次重构。
