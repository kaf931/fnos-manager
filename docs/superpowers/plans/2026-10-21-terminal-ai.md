# SSH AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在全屏 SSH 工作区加入可配置的 AI 聊天，逐条确认后通过当前 SSH 连接执行命令并回传输出。

**Architecture:** 复用 TerminalModule 的会话和账号边界，增加独立 AI Controller/application service、模型协议客户端、会话状态机、SSH exec 执行器和设置 Repository。配置写 SQLite，聊天和提议属于活跃 SSH 会话。前端使用现有工作区面板、公共表单和主题。

**Tech Stack:** NestJS / TypeScript strict / Express adapter / node:sqlite / Node fetch / ssh2 / 现有前端 JS 与公共 UI；不新增通用 agent 框架或 UI 库。

**Spec:** `docs/superpowers/specs/2026-10-21-terminal-ai-design.md`（用户已确认）

## Global Constraints

- 图标位于资产列表上方；面板与其他工作区入口互斥，桌面宽度 240px，移动端复用既有底部面板。
- 自定义 API 地址、API Key、模型，采用 Chat Completions function tools；唯一工具 run_ssh_command(command, explanation)。不默认选择模型。
- 每条命令必须用户确认；执行请求不能提交替代命令，后端只执行自己保存的提议。
- 单命令最大 16 KiB；执行最长 30 秒；stdout/stderr 合计最多 64 KiB；每个用户问题最多 10 次工具轮次；每会话最多一个生成/执行过程。
- 配置按账号持久化；聊天、提议按账号与 SSH 会话隔离；关闭会话清理；普通配置查询不返回 Key。
- 只发送用户消息及对应工具命令/输出，不自动发送终端历史、文件或 SSH 凭据。页面明确数据流。
- schema v2 -> v3 只新增 ai_settings，短事务登记版本，不清空现有数据；旧 v1 转换工具应生成当前 schema。
- Controller 不直接访问 Repository；外部 JSON 使用 unknown 校验；不使用 any、类型忽略或未校验断言代替边界。
- 不新建 Git 仓库或执行 commit：当前目录不是 Git 仓库。每任务更新此计划勾选状态和实施记录，构建统一顺序执行。

## Review Focus

1. 模型返回 HTML 错误页、超长参数或破碎 SSE 时，显示通用可诊断错误，不执行命令、不泄露 Key（任务 2）。
2. 用户在慢请求期间切换标签、重连或关闭会话，旧回复与执行按钮不得进入新会话（任务 4、5）。
3. 双击执行、跨账号提议 ID、确认与关闭竞争，至多执行一次且不能绕过归属检查（任务 4、5）。
4. 命令没有 exit-code、输出恰好达到/超过 65536 字节、远端断开，结果必须有限结束且语义准确（任务 3）。
5. 模型一次返回多条工具调用、拒绝其中一条、轮次到 10 后继续提议，保持协议配对且不自动执行（任务 4）。

## File Map

- `backend/domain/ai.ts`：设置、聊天、工具提议、执行结果与状态联合类型。
- `backend/persistence/ai.repository.ts`：仅 AI 设置 SQL；`schema.ts`、`database.service.ts`：版本升级；`upgrade/v1-to-v2.ts`：目标版本报告。
- `backend/terminal/ai/provider.ts`：URL 规范化、请求、有限 SSE/JSON 解析、工具参数验证。
- `backend/terminal/ai/executor.ts`：有界独立 SSH exec 通道及 AbortSignal。
- `backend/terminal/ai/conversation.ts`：会话状态、请求锁、提议确认和工具结果续聊。
- `backend/app/terminal/ai.dto.ts`、`ai.controller.ts`、`ai.service.ts`：API 验证、身份和业务协调。
- `backend/app/terminal/terminal.module.ts`、`terminal.service.ts`、`backend/terminal/transport.ts`、`backend/app/common/resources.ts`：注入与关闭顺序。
- `web/terminal-ai.js`、`terminal-ai-settings.js`、`terminal-ai-model.js`：面板、设置表单、前端会话请求状态；`index.html`、`terminal-workspace.js`、`terminal-workspace.css`：导航与布局接入；`terminal-monitor.js`、`terminal-transfers.js`：将 AI 按钮加入现有互斥面板的收起监听。
- 测试：`tests/ai-settings.test.js`、`ai-provider.test.js`、`ai-executor.test.js`、`ai-conversation.test.js`、`ai-api.test.js`、`ai-ui-model.test.js`；新增 `tests/fixtures/ai-provider.js`，复用既有 SSH fixture。

### Task 1: 设置、领域类型与数据库升级

**Interfaces:** `AiSettings {baseUrl, model, apiKey, updatedAt}`；`AiPublicSettings {baseUrl, model, hasKey}`。`AiSettingsRepository.get(owner): AiSettings|null`，`save(owner, settings): void`。应用层 `readSettings(owner): AiPublicSettings`，`saveSettings(owner, {baseUrl,model,apiKey?}): AiPublicSettings`；空白 Key 保持已有值，新设置没有 Key 也允许保存以支持无认证本地服务。

- [ ] 写 `ai-settings.test.js`：账号 A/B 隔离，读取只公开 hasKey；修改地址/模型留空 Key 保持原值；v2 图标/SSH/扫描记录在升级后 ID 和字段一致，PRAGMA user_version=3、integrity_check=ok、foreign_key_check 无结果。
- [ ] 运行 `npm run build:server && node --test tests/ai-settings.test.js`，确认新增行为失败。
- [ ] 实现领域类型、STRICT ai_settings(owner_uid PRIMARY KEY CHECK 非空, base_url, model, api_key, updated_at INTEGER) 和设置 Repository；创建和 v2 升级共用同一 DDL。版本变化和迁移登记置于单个事务；更新 v1 转换器及对应版本断言。URL 仅允许 http/https、长度最多 2048、无用户信息/查询/hash，保留用户配置的根路径并去尾斜杠。
- [ ] 重跑上述测试及 `tests/sqlite-schema.test.js tests/sqlite-upgrade.test.js tests/database.test.js`，全部通过。

### Task 2: OpenAI 兼容模型客户端

**Interfaces:** `AiToolCall {id,command,explanation}`；`AiTurn {content,toolCalls:AiToolCall[]}`；`AiProvider.complete(settings, messages, {signal,onText}): Promise<AiTurn>`。`AiProtocolMessage` 为 system/user/assistant/tool 的具体联合类型；tool 消息包含 tool_call_id。

- [ ] 写 provider mock 和 `ai-provider.test.js`：SSE 任意 TCP 分块与 UTF-8 边界、多个 tool_calls 按 index 拼接、普通 JSON 响应、tool_call_id 配对、HTTP 错误/HTML/畸形 JSON、超长内容和 16385 字节命令、取消及 Key 不出现在错误中。
- [ ] 运行定向测试，确认失败。
- [ ] 实现 `/chat/completions` 请求，发送 stream=true、单一工具及模型名；请求超时 60 秒，读取总响应最大 1 MiB、单轮文本/参数总量最大 128 KiB；所有大小按 UTF-8 字节计算。拒绝未知工具、重复工具 ID、空命令、不合法控制字符和多于 10 个工具调用；仅将完整校验后的工具调用交给状态机。
- [ ] 运行 `npm run build:server && node --test tests/ai-provider.test.js`，全部通过；确认 fetch 只携带 AI Authorization，不转发 NAS 请求头。

### Task 3: SSH exec 执行器

**Interfaces:** `executeAiCommand(session:TerminalSession, command:string, {signal,timeoutMs=30000,maxBytes=65536}): Promise<AiExecutionResult>`；结果 `{stdout,stderr,exitCode:number|null,status:'success'|'failed'|'timeout'|'cancelled',truncated:boolean}`。

- [ ] 写 `ai-executor.test.js`，复用 sshFixture.execHandler：stdout/stderr/退出码、非零退出、无退出码、30 秒超时（测试传短超时）、取消、断开、恰好/超过输出限制、中文字符截断；确认不向交互 shell 的 stdin 写入。
- [ ] 定向运行确认失败。
- [ ] 实现独立 session.client.exec，立即监听 signal、error、exit、close；仅 close 完成正常输出收集，非零/缺失退出码不报成功；超过上限或超时主动终止通道，清理计时器和监听器，截断不得拆坏 UTF-8。每会话的执行取消句柄由会话状态机持有。
- [ ] 定向测试通过，确认多个终止事件只结算一次。

### Task 4: 会话状态机及人工确认

**Interfaces:** `AiConversationService` 依赖 settings reader、provider 和 `(owner,sessionId)=>TerminalSession`，不依赖 Controller。方法：`snapshot(owner,sessionId)`、`message(owner,sessionId,text)`、`execute(owner,sessionId,proposalId)`、`reject(owner,sessionId,proposalId)`、`cancel(owner,sessionId)`、`clearSession(sessionId)`、`close():Promise<void>`。快照 `{revision,busy,messages,proposals}`，提议状态 pending/running/completed/rejected/expired；返回内容不含 Key。

- [ ] 写 `ai-conversation.test.js`：生成只保存提议，未确认执行次数=0；执行一次后 provider 收到对应 tool 消息；双击/换 owner/换 session 均不执行；取消/关闭后晚到响应不复活；同一问题最多 10 轮，多工具提议按顺序单独确认或拒绝；busy 时新消息返回 409。
- [ ] 定向运行确认失败。
- [ ] 实现 owner/session Map 与 revision；确认时同步将 pending 改为 running，再做异步 I/O。每次执行前重新获取 connectedOwned 会话，拒绝前端 command 字段。模型多工具响应先保存全部，待全部完成/拒绝后追加全部匹配 tool 结果再续聊；新一轮提议继续等待确认。取消将悬空提议标为 expired 并补齐工具结果，关闭销毁会话；系统提示声明独立 exec 环境和终端输出不可信。
- [ ] 定向测试通过，并用 mock 验证未上传 SSH 密码、私钥、完整终端缓冲区。

### Task 5: Nest API、生命周期和完整集成测试

**Interfaces:** GET/PUT `/terminal/ai/settings`；POST `/terminal/sessions/:id/ai/messages` body `{text}`；GET `/terminal/sessions/:id/ai/conversation`；POST `/terminal/sessions/:id/ai/proposals/:proposalId/execute` 或 `/reject` body `{}`；POST `/terminal/sessions/:id/ai/cancel` body `{}`。所有请求先经过 TerminalOwnerGuard；修改请求经过已有 CSRF Guard。

- [ ] 写 `ai-api.test.js`：跨账号、错误 CSRF、未知字段、替换 command 字段均拒绝；本地模型 mock + 真 SSH 完成消息/待确认/确认/输出/总结完整链路；关闭会话取消在途请求，重复执行不再次 exec，错误不泄露 Key。
- [ ] 运行确认失败。
- [ ] 实现 DTO、Controller、application service 并在 TerminalModule 注册。将 transport.onSessionRemoved 改为可组合的会话清理订阅接口，迁移现有文件传输订阅，确保 AI 和传输都被清理；Resources 先停止 AI 请求/通道，再关闭 terminalService 和数据库。新增模型生成/执行接口返回 202 后通过只读快照轮询，避免占用长 HTTP 请求。更新显式 Nest 路由覆盖测试为新增的 7 条路由。
- [ ] 运行 API、会话清理和既有 `terminal-api`、`terminal-transfers`、`nest-framework` 测试，全部通过。

### Task 6: 聊天面板、配置与前端会话状态

**Interfaces:** `mountTerminalAi({element,api,toast,onShow}) -> {select(target),hide(),dispose()}`，target 复用 `{id,generation,connected}`。`mountAiSettings({api,toast}) -> {open(),dispose()}`。前端纯状态模型 `createAiViewModel()` 提供 `select(target)`、`capture()`、`isCurrent(snapshot)`，会话/generation 变化使旧请求失效。

- [ ] 写 `ai-ui-model.test.js`：慢请求返回前切换标签/重连不改新会话；待确认按钮绑定原提议和原 session，不从当前全局变量替换；double-click busy 禁止重复提交。
- [ ] 定向运行确认失败。
- [ ] 实现 AI 图标于 assets 上方、240px 面板、消息/代码块/完整命令及执行拒绝按钮；不把模型文本当 HTML 渲染。消息区独立滚动，输入底部固定；Enter 发送、Shift+Enter 换行。设置用公共弹窗/输入和 setupPasswordVisibility，保存后仅显示 hasKey。显示发送数据范围及独立执行通道语义；无连接禁用发送执行，设置可用。切换标签时取消旧目标的在途生成并使 pending 提议过期，保留已完成对话；已确认运行中的命令按取消机制结束，不误归给新标签。
- [ ] 将 ai.select 接到 workspace.publish，监听 assets/commands/transfers/monitor 按钮进行互斥切换；dispose 清理轮询、事件和 React root（如使用）。定向测试及浏览器桌面/移动视口验证：首次配置、聊天、确认/拒绝、错误、切换、关闭、主题、长命令、触屏键盘和滚动。

### Task 7: 最终验证、文档与 NAS 更新

- [ ] 自查五项 Review Focus 对应测试，补齐缺口；复查所有确认路径只使用提议 ID、日志无 Key、配置无 owner 可伪造字段、会话关闭没有遗留请求。
- [ ] 依次执行 `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm test`、`npm run pack`，核验完整退出码与测试结果；不并行执行会清空 server/ 的构建。更新 `docs/backend-architecture.md`、`docs/sqlite-storage.md` 和进度记录，说明新增表、数据流和模型兼容限制。
- [ ] 上传最终运行包，停止 NAS 应用，核对现有业务数量，部署最终代码并启动。v2 -> v3 新增表升级不修改旧数据；核验版本、integrity_check、foreign_key_check、五菜单和新 AI 配置/权限接口、静态资源。保留 SSH 和扫描等记录，不执行清空更新。
- [ ] 模型 mock 验收与真实 SSH 测试通过不等于真实模型服务连通。若用户尚未提供兼容地址/Key/模型，交付时明确实际模型连通性待用户配置后验证；不编造结果或使用他人凭据。

## Self-review

已覆盖规格的 UI/协议/人工确认/账号和会话隔离/持久配置/有界执行/数据流/升级/验证要求。接口由任务 1–4 定义，任务 5–6 仅使用这些命名。上面新增的具体大小和请求时限是执行计划约束，不增加独立协议或自动执行模式。本计划现已实施，最终行为及用户后续确认的权限扩展见同目录 `2026-10-21-terminal-ai-progress.md`。执行方式沿用用户已指定的当前会话直接实施；计划确认后使用 executing-plans，不另开聊天或主动分派实现代理。
