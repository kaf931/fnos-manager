# SSH 工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单连接终端改为具有资产/快捷指令目录和独立连接标签的工作区。

**Architecture:** 后端在现有 owner、票据及凭据保护之上支持多会话，增加独立分类和指令存储。前端工作区管理独立终端实例，共享认证对话框按请求排队，文件面板跟随其所属实例。

**Tech Stack:** Node.js、Express、ssh2、WebSocket、xterm、React、Semi UI，沿用现有依赖。

**Spec:** `docs/superpowers/specs/2026-10-19-terminal-workspace-design.md`

## Global Constraints
- 每用户最多 8 个连接会话，全局最多 32 个。
- 目录最大深度 16；每条指令最多 16 KiB；每用户目录及指令合计最多 1000 条。
- 旧连接放在根目录，保留目标绑定加密凭据，不记录明文认证信息。
- 指令不自动追加回车；含换行的内容发送前确认。
- 标签切换保留输出和连接；关闭只释放该标签会话。
- 拖拽只改变光标，不改变分界线颜色；修改时间带年份。
- 在当前会话直接实施。工作区不是 Git 仓库，不初始化 Git，保留文件备份及验证记录代替提交。

## Review Focus
- 两个标签同时发出主机指纹/认证提示：按顺序处理，不能把凭据送往另一个会话。
- 文件选择器或确认框开启后切换标签：保留所属会话验证，不能写入新标签的主机。
- 多窗口使用同一连接：编辑保护须覆盖全部会话。
- 关闭连接请求尚未完成的标签：迟到的创建结果立即释放，不能留下后台会话。
- 指令内的换行、回车及控制字符：发送前提示多行风险，拒绝不支持的控制字符。

---

### Task 1: 分类与快捷指令持久化
**Files:** 新增 `server/terminal/workspace-store.js`、`tests/terminal-workspace-store.test.js`、`tests/terminal-workspace-api.test.js`；修改 `server/terminal/store.js`、`server/terminal/routes.js`。

**Interfaces:** `WorkspaceStore(dataDir).init()`；`list(owner,scope)`、`save(owner,{kind,scope,name,parentId,content},id?)`、`remove(owner,id)`；scope 为 assets/commands，kind 为 folder/command。连接 public 数据增加 folderId，save 接受 folderId，省略时保持旧值。路由 GET/POST `/terminal/workspace`、PUT/DELETE `/terminal/workspace/:id`。

- [ ] 写测试覆盖用户隔离、16 层深度、循环拒绝、1000 条和 16 KiB 上限、非空目录删除拒绝、旧连接根级兼容、分类修改不改变凭据。
- [ ] 运行 `node --test tests/terminal-workspace-*.test.js`，确认新接口测试失败。
- [ ] 实现分类存储及路由；使用终端存储的串行原子写入和 0600 权限；连接 folderId 校验与目录删除/连接写入使用同一串行事务协调器，避免悬空归属。
- [ ] 运行新测试及 `tests/terminal-store.test.js`、`tests/terminal-credentials.test.js`，全部通过后保存验证记录。

### Task 2: 后端多会话及连接编辑保护
**Files:** 修改 `server/terminal/transport.js`、`server/terminal/routes.js`、`tests/terminal-api.test.js`、`tests/terminal-transport.test.js`；新增 `tests/terminal-multi-session.test.js`。

**Interfaces:** 保留 `create`、`closeOwned`、`connectedOwned`；新增 `activeFor(owner)` 返回全部会话、`usesConnection(owner,id)` 返回布尔值。保留 active(owner) 兼容调用直至替换完成。

- [ ] 写测试验证两个会话独立创建/关闭、每用户第 9 个被拒绝、全局第 33 个被拒绝、跨用户关闭拒绝、第二个会话使用的连接不能编辑或删除。
- [ ] 运行新增及原接口测试，确认旧单会话限制导致失败。
- [ ] 修改限额与 ensureIdle，继续保持每会话票据、输出背压、心跳和过期释放。
- [ ] 运行 transport/API/session/file-route 相关测试全部通过，确认旧单会话断言已按新行为更新且安全断言保留。

### Task 3: 独立终端实例与标签生命周期
**Files:** 重构 `web/terminal-view.js`；新增 `web/terminal-workspace.js`、`web/terminal-tabs-model.js`、`web/terminal-dialog-queue.js`、对应 `tests/terminal-tabs-model.test.js` 及 `tests/terminal-dialog-queue.test.js`；修改 `web/terminal.js`、`web/index.html`、`web/terminal-files.js`。

**Interfaces:** `createTerminalView({element,api,toast,state,confirm,onState})` 按传入根元素查询子节点，返回 connect/show/hide/disconnect/dispose/sendCommand、active/currentId。`createTerminalWorkspace({element,...})` 返回 open(connection)、show/hide、close(connectionId)、usesConnection(connectionId)、sendCommand(text)。确认队列项携带实例 ID/generation，取消后不执行回调。

- [ ] 写模型测试：重复打开激活已有标签、关闭当前选择相邻、关闭最后一个显示空态、未完成创建的标签关闭后迟到会话被释放、关闭 A 不影响 B。
- [ ] 写对话框队列测试：A/B 请求按序，关闭 A 取消其待办，不能误发 B 凭据；指令单行不加 Enter，多行确认取消不发送。
- [ ] 运行模型测试观察失败，再实现标签管理与独立视图；每个视图保留 xterm、输出 sink、generation、文件组件，清理观察器及事件。
- [ ] 去除原标题、副标题、状态、清屏、断开按钮；加入标签前侧关闭按钮及无连接空态，保留错误重试和返回工具箱入口。
- [ ] 文件面板 DOM ID 使用实例前缀，保留当前目录和历史；隐藏实例不抢焦点，重新显示触发 fit。验证切换期间上传/确认操作不能串会话。
- [ ] 运行所有终端单元及集成测试，记录通过结果。

### Task 4: 资产及快捷指令树和响应式样式
**Files:** 新增 `web/terminal-assets.js`、`web/terminal-workspace.css`；修改 `web/terminal.js`、`web/index.html`、`web/native-ui.css`；新增 `tests/terminal-tree-model.test.js`、`web/terminal-tree-model.js`。

**Interfaces:** `mountTerminalAssets({element,api,openConnection,editConnection,sendCommand,confirm,onChange})` 返回 refresh/dispose。目录树按 scope 分离；编辑连接加入所属目录字段。

- [ ] 写树模型测试覆盖根级旧连接、嵌套排序、移动条目、无效父级与循环拒绝，再运行确认失败。
- [ ] 实现只含图标的左栏及悬浮说明；分类树右键/长按菜单和更多入口，新建目录/终端/指令，重命名和空目录删除。
- [ ] 指令编辑沿用现有输入和弹窗样式，调用当前标签 sendCommand；无已连接标签明确提示。控制字符拒绝，多行发送必须确认。
- [ ] 桌面分类树与终端并排；移动端分类改底部面板，标签横向滚动，保持系统安全区和现有键盘处理方式。
- [ ] 运行树模型及全套测试；浏览器验证桌面右键、移动长按/更多、新建归属、标签关闭和返回入口。

### Task 5: 完整验证、备份及 NAS 更新
**Files:** 修改 `docs/verification.md`、`README.md`、版本及原生包元数据（如需发布新版本保持一致）。

- [ ] 使用本地 SSH 夹具建立两个连接，分别执行只读标记并确认输出隔离；切换后目录、文件面板展开状态保留；关闭一个后另一个可用。
- [ ] 验证上传选择器跨标签、认证队列取消、连接编辑保护、关闭未完成连接及异常断线的重试；不执行真实用户快捷指令。
- [ ] 运行 `npm test`、`npm run build`、`npm run pack`，全部成功；做独立复核并修复发现的问题。
- [ ] 备份 NAS target/data/manifest，再更新应用；现有图标、计划任务、连接和密钥保留。若有用户活跃终端，不强制断开，等待明确更新窗口。
- [ ] 核对运行状态与资源版本，保存桌面/移动截图、测试数量及备份位置到验证文档。
