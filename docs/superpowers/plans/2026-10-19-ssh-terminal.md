# SSH Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 默认建议由当前会话直接实施；执行方式待用户选择。若用户选择逐任务子代理，则改用 superpowers:subagent-driven-development。

**Goal:** 在 NAS 工具箱增加与现有界面对齐、支持 NAS 本机及远程 SSH 的终端菜单。

**Architecture:** 浏览器 xterm.js 经统一网关 WebSocket 与 Node.js 会话管理器通信，由 ssh2 连接目标。HTTP 管理用户连接及一次性握手票据，主机密钥与连接配置独立持久化；认证材料和终端输出仅在内存。提取三菜单导航，保持图标及计划任务业务逻辑。

**Tech Stack:** Node.js 22、Express 5、ws、ssh2、xterm.js、Vite、现有 React/Semi UI 和 node:test。

**Spec:** `docs/superpowers/specs/2026-10-19-ssh-terminal-design.md`

## Global Constraints

- “本机”指运行应用的 NAS，不是访问页面的手机或电脑。本机也通过 SSH 登录，端口可配置、默认 22。
- 首版同时只允许一个活动终端会话：切换其他菜单保留连接和终端实例。
- 密码、私钥及口令仅用于此次连接。凭据、会话票据和终端内容不写入数据文件或日志。
- 生产环境要求管理员和有效 X-Trim-Userid；不同用户的配置、信任和会话隔离。
- 统一网关和 app.sock 保持不变，WebSocket 路径为 /app/deskicons/terminal/ws。
- 票据绑定用户和会话，30 秒过期、单次使用；首条 WebSocket 认证消息必须在 5 秒内到达。
- 文件权限 0600、目录 0700，数据原子替换。主机密钥变化阻止连接。
- 移动编辑保持普通页面布局，不恢复额外键盘避让；终端不启用下拉刷新。
- 正式版本升级为 0.2.8；不在代码、文档或测试中复制用户实际凭据。
- 当前目录没有 Git 仓库：按文件完成检查，不创建仓库或伪称已提交。执行前检查 using-git-worktrees 技能适用条件，保存本次修改涉及文件的本地备份。

## Review Focus

- 网关重写 Host：合法登录来源仍能连接，伪造 Origin 不能跨站使用终端（任务 3）。
- 首次和变更的主机密钥：认证凭据必须在确认后才交给 SSH，不能默认接受（任务 2）。
- 手机中文输入、缩放、虚拟键盘：终端保持可输入，不重演表单键盘补偿和重复字符（任务 5）。
- 慢客户端及远端大量输出：内存有界，断开后释放 SSH、计时器和 WebSocket（任务 2、3）。
- 三菜单与恢复页面：任务轮询只在任务菜单激活，切换不丢终端实例，标题正确（任务 4、5）。

---

### Task 1: 连接配置和信任存储

**Files:** Create `server/terminal/model.js`, `server/terminal/store.js`; Test `tests/terminal-store.test.js`。

**Interfaces:**
- `validateConnection(input) -> {name,kind,host,port,username}`：kind 为 local/remote，local 强制 127.0.0.1；port 整数 1..65535；name 1..80 字符、username 1..128 字符，不含控制字符；host 是不带 URL/路径/空白的 DNS、IPv4 或 IPv6，限制 253 字符。
- `TerminalStore(dataDir).init()`，`list(ownerUid)`，`get(ownerUid,id)`，`save(ownerUid,input,id?)`，`remove(ownerUid,id)`，`getHostKey(ownerUid,host,port,algorithm)`，`trustHostKey(ownerUid,{host,port,algorithm,key,fingerprint})`。
- 非法或他人 ID 统一 404；创建生成随机 ID 和时间戳，只允许白名单字段落盘。

- [x] 写失败测试 `validates_connection_fields_and_forces_local_loopback`：断言 local 的 host 为 127.0.0.1、默认 port 为 22；拒绝端口 0/65536、非法 kind、URL 主机、控制字符。
- [x] 写失败测试 `store_isolates_owners_and_excludes_credentials`：不同 UID 列表隔离；提交 password/privateKey/passphrase 不出现在读取结果和文件；重建 store 后连接与信任保留，目录/文件权限符合规格。
- [x] 运行 `node --test tests/terminal-store.test.js`，确认因模块缺失失败。
- [x] 实现接口，写入队列使用临时文件加 rename；验证已存储结构，文件损坏报明确错误而非默默覆盖。
- [x] 再运行上述命令，确认所有断言通过；记录任务完成，无 Git 提交步骤。

### Task 2: SSH 会话与主机指纹

**Files:** Create `server/terminal/session.js`; Test `tests/terminal-session.test.js`, `tests/fixtures/ssh-server.js`; Modify `package.json`, `package-lock.json`。

**Interfaces:**
- `TerminalSession({connection,ownerUid,store,emit,clientFactory?,timers?})`；方法 `start()`、`acceptHost({fingerprint,replace})`、`authenticate({method,password,privateKey,passphrase})`、`input(text)`、`resize({cols,rows})`、`close(reason)`。
- emit 为 `({type,...payload})=>void`，输出通过 output 消息传递。状态采用规格中的有向流程，关闭幂等。
- `close` 释放 SSH 流、客户端及计时器；终态消息不含底层凭据或整段异常配置。

- [x] 写失败测试 `requires_host_trust_before_credentials`、`rejects_changed_key_without_explicit_replacement`：模拟 ssh2 事件及异步认证回调，断言未信任时不调用密码/私钥认证，取消结束会话，替换需明确 true。
- [x] 写失败测试 `session_gates_input_resize_and_cleans_up`：未连接不能 input；resize cols 2..500、rows 1..300；超过 16KiB 输入拒绝；30 秒 SSH 握手、60 秒确认/凭据等待超时；重复关闭安全。
- [x] 运行 `node --test tests/terminal-session.test.js` 确认失败。
- [x] 安装并锁定 ssh2/ws 稳定版本；实现 hostVerifier 与异步 authHandler，先确认主机公钥，再等待凭据；使用 xterm-256color PTY，SSH 保活 15 秒、最多 3 次无响应。
- [x] 用 ssh2.Server 和临时生成的测试密钥构建回环隔离 fixture，覆盖密码、私钥、加密私钥、交互式 echo 与 setWindow、认证失败、服务关闭。全部使用虚构测试凭据。
- [x] 增加 `large_output_is_bounded_and_disconnect_releases_resources`：1MiB 待发上限触发关闭，断开不保留缓冲；连接错误分类，不回传凭据。
- [x] 再运行任务 1、2 测试，确认通过；记录接口与实际依赖版本。

### Task 3: HTTP、WebSocket 与生产网关

**Files:** Create `server/terminal/routes.js`, `server/terminal/transport.js`; Modify `server/index.js`; Test `tests/terminal-api.test.js`, `tests/terminal-transport.test.js`。

**Interfaces:**
- `mountTerminal(router,{dataDir,gateway,csrfToken}) -> Promise<TerminalService>`；服务提供 `attach(server)`、`close()` 和测试所需只读会话数量。
- 服务挂到 `app.locals.terminalService`。生产入口 `const server=app.listen(...)` 后调用 attach；测试显式 attach；关机先关闭终端再关闭 taskEngine。
- API 为规格的 connections CRUD、POST sessions、DELETE sessions/:id；创建 session 返回 `{id,ticket,expiresAt}`。服务端票据只存 SHA-256 摘要。
- WebSocket 不使用 URL token；首条 authenticate 为 `{type:'authenticate',id,ticket}`。成功后只允许规格消息；服务器身份来自网关而非消息。

- [x] 写失败 HTTP 测试：管理员有效 UID 与 CSRF 可以 CRUD；缺失 UID、非管理员、错误 CSRF、他人连接/会话被拒绝；重复创建活动会话返回 409。
- [x] 写失败 transport 测试：30 秒过期、重放票据、错误 UID、未在 5 秒认证、未知路径、额外查询凭据、错误 Origin 被拒绝，首条认证成功才启动 SSH。
- [x] 运行 `node --test tests/terminal-api.test.js tests/terminal-transport.test.js` 确认失败。
- [x] 实现路由及显式 upgrade 鉴权；maxPayload 128KiB，认证前最多 4KiB；拒绝二进制和无效 JSON；单 IP 每分钟最多 30 次握手，同用户最多一个待连接或活动会话，定期回收过期票据。
- [x] 连接创建时记录经过严格语法校验的请求 Origin，与后续 WebSocket Origin 完全匹配；单次、UID 绑定、CSRF 保护的票据负责关联授权。开发模式还要求 Origin 与当前监听 Host 一致；网关模式不把重写后的内部 Host 当公开 Origin，也不盲信任外部 X-Forwarded-Host。
- [x] 增加 `rewritten_host_preserves_legitimate_origin_but_rejects_other_origin` 测试，使用 NAS 形式公开 Origin 与内部 Host 验证；在真实 NAS 检查转发头后确认此策略，不为适配去掉 Origin 校验。
- [x] WebSocket bufferedAmount 加输出队列总量限制为 1MiB，心跳 30 秒，超过 60 秒未 pong 关闭；socket close/error 级联清理 SSH。
- [x] 运行任务 1..3 测试及现有 `tests/api.test.js`，确认未影响原有路由。应用不增加任何独立生产监听端口。

### Task 4: 三菜单导航与连接列表

**Files:** Create `web/navigation.js`, `web/terminal.js`, `web/terminal-connections.js`; Modify `web/index.html`, `web/main.js`, `web/tasks.js`, `web/platform.js`, `web/native-ui.css`; Test `tests/navigation.test.js`。

**Interfaces:**
- `setupNavigation({initial:'icons',onChange}) -> {activate(page),current()}`，page 仅 icons/tasks/terminal；触发 `deskicons:pagechange` CustomEvent，detail `{page,title}`。
- `setupTaskUI` 不再给所有导航按钮赋 onclick，改监听统一事件设置 active、需要时 load。
- `setupTerminalUI({api,toast,state})` 安装列表逻辑；终端菜单首次激活后动态 import 终端视图，避免首屏加载 xterm。

- [x] 写失败 `navigation_shows_exactly_one_page_and_emits_title` 测试：三个页面切换时 hidden、active、title、事件一致，非法 page 不切换。
- [x] 运行 `node --test tests/navigation.test.js` 确认失败。
- [x] 实现导航，替换 tasks.js 的二菜单逻辑；platform.js 从统一事件读取标题，不再判断 tasks hidden 推断标题。
- [x] 新增 terminal-page，复用 search-field、现有筛选组件和移动更多按钮；连接列表显示名称、地址、用户名、本机/远程和连接入口。空状态提供新增按钮；列表移动端下拉刷新。
- [x] 新增连接编辑表单使用 createTaskFormControls/openEditorSurface/setupDialogDismiss；连接操作单独弹认证流程，凭据不进入连接保存请求；删除活动配置先明确提示并断开。
- [x] 运行导航测试、`npm run build`；浏览器验证 1005px 和 393px 的三菜单、搜索/筛选、增改删除、更多按钮对齐和主题。只在隔离本地数据上操作。

### Task 5: 终端界面及移动交互

**Files:** Create `web/terminal-view.js`, `web/terminal-protocol.js`; Modify `web/terminal.js`, `web/native-ui.css`, `web/platform.js`, `package.json`, `package-lock.json`; Test `tests/terminal-protocol.test.js`。

**Interfaces:**
- `createTerminalView({container,api,toast,state,onClose}) -> {connect(connection),show(),hide(),disconnect(),dispose()}`。当前实例在导航切换时保留，只有明确结束/页面退出才销毁。
- protocol 模块提供输入状态约束、resize 数值规范化、状态到用户文案映射及辅助键编码；组件不得自动重放 input。

- [x] 写失败 `terminal_protocol_rejects_input_before_connected`、`auxiliary_keys_encode_ctrl_escape_tab_and_arrows`、`terminal_resize_clamps_rows_and_columns`；覆盖 Ctrl+C、Esc、Tab、箭头和重复 Ctrl 解除。
- [x] 运行 `node --test tests/terminal-protocol.test.js` 确认失败。
- [x] 安装并锁定 @xterm/xterm、@xterm/addon-fit；实现按需加载、ResizeObserver fit 与有限回滚 3000 行。主题从现有 theme-mode 更新，不给整页引入另一套组件样式。
- [x] 实现会话创建→WS首条认证→主机指纹确认→凭据→PTY 的前端状态流；指纹变化必须明确替换，错误与超时可重试但不自动重连。认证提交后清空输入并释放前端凭据引用，不输出 console。
- [x] 实现返回列表、会话恢复、清屏、断开、重连和切换目标确认。beforeunload/SDK 离开提示覆盖活动终端并与现有未保存表单逻辑合并，避免互相覆盖；pagehide 做尽力关闭，后端以 WebSocket 断开作为最终依据。
- [x] 实现移动辅助栏，不对 compositionstart/update/end 注入额外按键；终端仍由 xterm 处理 IME。不修改 mobile-navigation 的键盘高度策略、不把终端变成可下拉刷新的区域。
- [x] 浏览器连接隔离 fixture，验证中英文输入、全屏终端程序、resize、主题、断开重连、切换菜单保留、输出溢出关闭和手机视口布局；实体手机 IME/键盘动画留明确实机复测说明。
- [x] 运行 `npm test`、`npm run build` 并检查 console；所有失败修复后进入发布。

### Task 6: 打包、NAS 验证与交付

**Files:** Modify `package.json`, `package-lock.json`, `server/index.js`, `scripts/package.js`, `README.md`, `docs/verification.md`; Add dependency licenses to `third-party/` as needed; Test `tests/package.test.js`。

**Interfaces:** 发布版本 0.2.8；生产包包含服务端 ssh2/ws；前端 xterm 已编译，无需额外终端服务。

- [x] 更新打包测试，断言 manifest、运行时 package.json 和 /state 版本为 0.2.8，运行时依赖含 ssh2/ws，网关入口不变。先运行测试确认旧版本或依赖缺失导致失败。
- [x] 实现版本和依赖打包更新，记录上游许可证与来源，README 说明 NAS 发起连接、SSH 权限、凭据仅当次、信任主机和关闭页面即断开。
- [x] 运行 `npm test`、`npm run build`、`npm run pack`，检查 linux-x64 运行依赖可导入；不在 NAS 修改系统 SSH 配置。
- [x] 备份原 FPK、target 和真实数据 /vol1/@appdata/deskicons；保留现有连接、任务和图标目录，确认官方升级方式，避免用 install-fpk 跳过已安装包或仅手动重启造成管理器状态异常。
- [x] 更新 NAS 应用及后端依赖；通过官方管理器确认 running 和版本 0.2.8；检查网关 WebSocket 身份/Origin 和静态资源摘要。
- [x] 使用当前已授权 SSH 账号通过新菜单连接 NAS，指纹与独立 SSH 读取结果比对，仅运行 whoami、pwd，随后断开。不执行计划任务、重启或清理操作；凭据仅在操作工具中传递，不存测试文件或截图。
- [x] 远程功能以隔离测试 SSH 服务结果交付；没有实际远程主机不声称公网实测成功。记录移动端真实手机仍待复测项目。
- [x] 保存桌面/移动/终端截图，更新 verification，包括备份位置、测试结果、安装版本和实机验证边界。关闭临时浏览器标签与 fixture 服务，保留必要预览服务说明。

## 自查与执行交接

规格的功能、身份、指纹、凭据、生命周期、移动交互、打包和发布分别由任务 1..6 覆盖；Review Focus 已归入对应测试或浏览器验证。服务端文件接口在前端任务中沿用，不引入第二套会话协议。实施中遇到库行为限制，先验证并修订受影响设计，不能以自动信任主机或持久保存凭据替代。

建议当前会话直接实施（executing-plans）：六项任务依赖同一条会话协议，连续执行有利于接口一致；完成后做独立最终审查。另一种方式为逐任务子代理实施与审查；由用户选择后开始。
