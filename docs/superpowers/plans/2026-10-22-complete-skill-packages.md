# 完整 Skills 包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 能导入完整 Skills ZIP、按需读取资源，通过当前 SSH 准备原始脚本环境，并完成官方 fnOS OAuth。

**Architecture:** 技能定义和包元数据存 SQLite，原始文件存应用数据目录；不可变修订连接资源读取和执行提案。SSH 用户执行原始脚本，官方授权辅助只编排同包 CLI 的 OAuth，不实现第二套业务操作目录。

**Tech Stack:** 现有 NestJS/TypeScript/SQLite、React/Semi Design、ssh2；新增固定 yauzl 3.4.0 与开发类型 @types/yauzl 3.4.0，流式读取 ZIP，node:crypto 校验摘要。

**Spec:** [完整 Skills 包设计](../specs/2026-10-22-complete-skill-packages-design.md)

## Global Constraints

- 保留单 SKILL.md 功能、所有现存业务数据及计划任务全局授权；不共享其 profile 给 AI。
- 每账号最多 50 个技能；SKILL.md 最大 64 KiB，frontmatter 最大 8 KiB。
- ZIP 最大 10 MiB，最多 512 条目，总展开 32 MiB，单文件 4 MiB；文件内容及脚本摘要保真。
- HTTPS 导入最多 3 次重定向、总超时 20 秒；每跳校验地址和解析 IP，拒绝私网、环回和链路本地。
- 文本资源每次最多 64 KiB、每轮总计 256 KiB；仅登记路径，拒绝二进制文本读取。
- 准备官方运行时最多 120 秒，后续 SSH 业务命令仍为 30 秒；默认审核，启用技能不执行代码。
- 官方包固定 0.5.1，SHA256 318038b6e50599297dc83dc23550cc405a31dd3c062c7037c90b98383170cb2a；不可使用随应用的 0.5.0 CLI 替代同包启动器。
- 原始包文件不存数据库；SQLite schema11 增量迁移；UI 使用现有公共组件、间距和移动底部面板。
- 当前会话直接实施。验证后 SSH 停止→替换运行文件→启动，保留数据，不用应用中心升级；版本维持 0.2.52。
- 当前目录非 Git 仓库；各任务记录检查结果，不执行虚假的 git commit，不自行初始化仓库。

## Review Focus

1. DNS 重绑定及 IPv4 映射 IPv6：连接必须使用已校验的地址，重定向不能绕过禁私网规则（任务 2）。
2. 两个页面同时替换同一技能：修订比较失败返回 409，不能出现正文与文件来自不同版本（任务 3）。
3. 文件已发布但 SQLite 事务失败或进程退出：旧版本仍可读，未引用暂存目录可回收（任务 3）。
4. 恢复旧历史中的工具调用：保持四协议配对，不重放运行准备或旧版本命令（任务 5）。
5. 授权码已兑换但只读验证失败：先探测已保存 session，不再次消费同一个 code（任务 6）。

---

## 文件职责

- `backend/domain/ai-skill-packages.ts`：包、文件、修订、资源页、导入及运行准备契约与限额。
- `backend/terminal/ai/skill-packages/archive.ts`：ZIP 校验；`download.ts`：受限 HTTPS 获取；`store.ts`：本地不可变文件生命周期。
- `backend/persistence/ai-skill-package.repository.ts`：包与文件 SQL；`ai-skill-authorization.repository.ts`：官方连接元数据。
- `backend/terminal/ai/skill-packages/service.ts`：预览/确认/替换/删除协调；`resources.ts`：按需资源读取。
- `backend/terminal/ai/skill-packages/runtime.ts`：SFTP 准备；`fnos-auth.ts`：官方授权编排。
- `backend/terminal/ai/skill-actions.ts`：资源/准备工具与现有对话之间的适配，避免 conversation 堆积文件处理代码。
- `backend/app/terminal/ai-skills.controller.ts`、`ai-skills.dto.ts`：从原 AI controller 分出技能 API、DTO，保持旧 URL。
- `web/terminal-ai-skill-package.tsx`、`terminal-ai-skill-resources.tsx`、`terminal-ai-skill-auth.tsx`：复用现有技能管理的导入、资源查看、授权内容组件。
- 改动现有 domain/ai、四协议工具处理、conversation、ai.service/module、技能管理、合同生成及公共提案渲染；不重构无关业务。

### Task 1: schema12 与端到端类型

**Files:** Create domain/ai-skill-packages.ts、两份 repository；Modify persistence/schema.ts、ai-skill.repository.ts、domain/ai-skills.ts、domain/ai.ts；Test tests/ai-skill-packages.test.js、sqlite-schema.test.js。

**Interfaces:**
- `SkillPackageRef { skillId: string; packageId: string; revision: number; sha256: string }`。
- `SkillPackageFile { path: string; size: number; sha256: string; text: boolean }`。
- `SkillPackageManifest { ref: SkillPackageRef; files: SkillPackageFile[]; sourceUrl?: string; official: boolean }`。
- `AiSkillSummary` 增加 `kind: 'document' | 'package'`、`revision: number`；包详情提供 manifest，正文编辑仅 document。
- `AiSkillPackageRepository.get(owner: string, ref: SkillPackageRef): SkillPackageManifest`；`publish(owner, expectedRevision: number | null, manifest, definition): AiSkill`，参数 definition 使用既有 AiSkillDefinition；`unreferenced(): SkillPackageRef[]`。
- 授权元数据契约 `SkillAuthorization { id, owner, connectionId, origin, profile, packageId, revision, status, pendingAt, updatedAt }`，status 为 disconnected/pending/connected，时间为整数毫秒。

- [ ] 写失败回归：schema11 升级后旧技能 kind=document/revision=1，旧业务表行数不变；跨账号读取拒绝；重复路径、无效大小/状态、孤立外键插入失败。
- [ ] `npm run build:server && node --test tests/ai-skill-packages.test.js tests/sqlite-schema.test.js`，确认新接口/迁移测试失败。
- [ ] 新增 STRICT ai_skill_packages、ai_skill_package_files、ai_skill_authorizations；owner 外键/联合唯一键防跨账号引用，按 owner/skill/revision 建索引。CAS publish 事务只切换同账号匹配 expectedRevision 的技能，失败 409。旧单文件 API 返回新增字段，不改变存储正文。
- [ ] 重跑上述命令，全部通过；记录 migration/外键结果。

### Task 2: 安全下载与 ZIP 校验

**Files:** Create archive.ts、download.ts；Modify package.json、package-lock.json、运行依赖锁；Test tests/ai-skill-package-import.test.js。

**Interfaces:**
- `downloadSkillZip(url: string, signal: AbortSignal): Promise<Buffer>`，依赖注入 DNS/HTTPS 请求用于测试。
- `readSkillArchive(zip: Buffer, signal: AbortSignal): Promise<{ definition: AiSkillDefinition; files: Array<{path: string; bytes: Buffer; sha256: string; text: boolean}>; sha256: string }>`。

- [ ] 写夹具断言：唯一根 SKILL.md 可导入且脚本逐字节相同；双根技能、../、盘符、反斜线、符号链接、加密、重复规范路径、CRC 错误拒绝；第 513 条/单文件超过 4 MiB/总量超过 32 MiB/输入超过 10 MiB 拒绝。
- [ ] 写网络断言：每跳 DNS 校验并绑定实际连接地址；映射 IPv6 私网拒绝；第 4 次跳转、超时、超长流拒绝；无 Cookie/Authorization 透传。
- [ ] 构建后执行 `node --test tests/ai-skill-package-import.test.js`，确认失败。
- [ ] 固定新增依赖，用 yauzl lazyEntries/readStream 控制内存和 CRC 校验；规范路径、唯一 SKILL 根、实际流计数，复用 parseSkillDocument。HTTPS 不自动跳转，不执行包代码，不解压到未验证目标。
- [ ] 重跑通过；运行依赖锁包含 yauzl 和其实际生产依赖。

### Task 3: 包存储、导入确认和资源读取

**Files:** Create store.ts、service.ts、resources.ts；Modify ai-skill.repository.ts；Test tests/ai-skill-package-storage.test.js。

**Interfaces:**
- `SkillPackageService.preview(owner: string, input: {zip?: Buffer; url?: string; official?: true}, signal: AbortSignal): Promise<{previewId: string; name: string; description: string; sha256: string; fileCount: number; size: number; hasScripts: boolean}>`。
- `commit(owner: string, previewId: string, replacement?: {skillId: string; expectedRevision: number}): Promise<AiSkill>`，预览 ID 属于当前账号、10 分钟失效；新建默认禁用，替换同名显式请求且默认禁用。
- `SkillResources.list(owner: string, ref: SkillPackageRef): SkillPackageFile[]`。
- `read(owner: string, ref: SkillPackageRef, path: string, offset: number): Promise<{text: string; nextOffset: number | null; totalBytes: number}>`，offset 为 UTF-8 字节偏移，页边界不截断字符。
- `SkillPackageStore.acquire(ref): {release(): void}`；`sweep(): Promise<void>` 只回收无数据库/活跃引用的暂存或旧版本。

- [ ] 写失败测试：预览过期/其他账号确认失败；默认禁用；并发 CAS 一成一败；事务失败/崩溃后旧版可读；活跃引用释放后才回收。
- [ ] 写资源断言：超界/二进制/链接/摘要变化拒绝，64 KiB 分页中文不破字节，未知路径不可读；单文件技能流程不变。
- [ ] 构建并运行 `node --test tests/ai-skill-package-storage.test.js`，确认失败。
- [ ] 实现 appData 下 UUID 暂存与原子发布、0700/0600、失败清理及启动 sweep；repository 不访问任意客户端路径；资源查询重新验证启用、owner 和修订。
- [ ] 重跑通过；异常注入后检查无可启用半包。

### Task 4: SSH 运行准备

**Files:** Create runtime.ts；Modify domain/ai.ts、terminal/ai/executor.ts（只抽共享取消基础）；Test tests/ai-skill-runtime.test.js、fixtures/sftp-server.js。

**Interfaces:**
- `prepareSkillRuntime(session: AiExecSession, owner: string, manifest: SkillPackageManifest, store: SkillPackageStore, signal: AbortSignal): Promise<{root: string; platform: string; runtimeVersion?: string}>`。
- 准备提案判别类型 `kind: 'prepare_skill_runtime'`，字段 ref、explanation；旧 SSH 提案 `kind: 'ssh_command'`，读取旧历史缺失 kind 时只映射 SSH 且 pending 失效。

- [ ] 失败回归：POSIX 环境检测；私有 HOME 目录；SFTP 临时上传、摘要校验和发布；链接/不匹配目录拒绝；取消/断线后临时文件清理；重复准备复用一致目录。
- [ ] 断言未知包绝不执行初始化脚本，官方摘要通过才运行同包 version；超时 120 秒及取消关闭通道；不调用 sudo，不借用计划任务 CLI。
- [ ] 构建执行 `node --test tests/ai-skill-runtime.test.js`，确认失败。
- [ ] 实现准备器，发布后记录完成标记；先检查远端父路径及权限。仅准备成功返回绝对根路径；支持 POSIX，其余环境清楚报不支持。
- [ ] 重跑通过；输出中不得包含 session、token 或用户 SSH 凭据。

### Task 5: 四协议工具、审核与取消

**Files:** Create skill-actions.ts；Modify tools.ts、conversation.ts、provider.ts、native-protocols.ts、gemini.ts、domain/ai.ts；Test ai-skills.test.js、ai-conversation.test.js、ai-native-protocols.test.js、ai-gemini.test.js。

**Interfaces:**
- 工具 `list_skill_resources {name, revision}`、`read_skill_resource {name, revision, path, offset}`、`prepare_skill_runtime {name, revision, explanation}`。
- `SkillActions` 注入 catalog/read/list/readResource/prepare，由当前 owner/session 定位服务；模型不能指定 owner、远端根目录或实际 CLI 二进制路径。
- 本轮资源预算累计 256 KiB；prepare 返回待审核提案，绝非只读工具自动执行。

- [ ] 写四协议混合工具结果配对和历史恢复断言；资源目录不注入全部正文，分页去重、预算耗尽明确停止；旧修订提案不能执行。
- [ ] 写审核模式上传次数为 0，确认后为 1；静默仅当前会话；停止/关闭/拒绝/迟到准备结果不继续执行；恢复历史不重放上传。
- [ ] 构建并跑上述四个测试文件，确认新增场景失败。
- [ ] 实现统一工具解析和提案联合分发；只读资源绑定本轮修订，副作用进入已有执行队列；删除或替换技能时使其旧修订的待执行提案失效，取消对应准备任务并等待释放文件引用。历史持久化不保存本地包绝对路径或凭据。
- [ ] 重跑通过，并跑既有 AI 并发与执行测试防回归。

### Task 6: 原始官方 CLI 授权辅助

**Files:** Create fnos-auth.ts；Modify ai-skill-authorization.repository.ts；Test tests/ai-skill-fnos-auth.test.js。

**Interfaces:**
- `FnOsSkillAuth.begin(owner: string, sessionId: string, ref: SkillPackageRef, origin: string, fileFallback: boolean): Promise<{authorizationId: string; url: string; expiresAt: number}>`。
- `exchange(owner: string, sessionId: string, authorizationId: string, code: string): Promise<{connected: boolean}>`。
- `status(owner, sessionId, authorizationId): SkillAuthorization`、`disconnect(owner, sessionId, authorizationId): Promise<void>`；完整参数类型按前两方法定义，不接受模型提供环境变量。

- [ ] 写失败断言：未知包不能生成授权表单；跨账号/跨连接/变目标/过期/同时兑换拒绝；固定同包启动器、profile、环境、TLS 与 origin 参数。
- [ ] 断言 token_persisted/refresh_token_persisted 和只读探测均通过才 connected；已兑换但探测失败先复测，不再交换 code；无自动 file 存储回退。
- [ ] 构建后跑 `node --test tests/ai-skill-fnos-auth.test.js`，确认失败。
- [ ] 实现 profile 串行及 5 分钟 pending；正确 shell 引用每个参数，关闭 trace；专用请求处理 code，返回/聊天/日志不含敏感值；断开只清理相应 CLI profile。现有全局 OfficialClient 不改写。
- [ ] 重跑通过；模拟取消/服务关闭后任务排空，无 pending 锁遗留。

### Task 7: Nest API 与公共管理界面

**Files:** Create ai-skills.controller.ts、ai-skills.dto.ts、三个 web 组件；Modify ai.controller.ts、ai.service.ts、terminal.module.ts、terminal-ai-skills.tsx、ai-command-ui.tsx、web/contracts/ai.ts；Test tests/ai-skill-packages-api.test.js、ai-concurrency-ui.test.js。

**Interfaces:**
- 保留原 skills CRUD URL；新增 `POST terminal/ai/skill-packages/preview`（限长原始 ZIP 或 URL JSON）、`POST terminal/ai/skill-packages/commit`、`GET terminal/ai/skills/:id/resources` 及资源分页读取。
- `POST terminal/sessions/:id/ai/skill-authorizations`、`POST .../skill-authorizations/:authorizationId/exchange`、`GET/DELETE .../skill-authorizations/:authorizationId`；授权输入不经过 chat DTO。
- UI 包详情显示 kind/revision/source/hash/files，正文只读；替换需确认，单文件继续编辑。按钮和菜单沿用项目命名与 Tooltip，不添加新主题。

- [ ] 失败 API 回归：所有新增路由鉴权、owner、CSRF、请求大小/类型、错误码；普通用户不能通过资源下载绕过启用/归属限制。
- [ ] UI 回归：导入预览→确认→默认禁用、取消过期读取不覆盖草稿、替换冲突提示、文本资源分页、准备审核、授权码关闭清空。
- [ ] 构建 server/test-web 后执行两个测试文件，确认新增断言失败。
- [ ] 按现有 Nest resources 生命周期注入服务，拆分 controller 时保持原路由；生成前后端契约。实现公共弹窗/移动底部面板、文件索引与进度，错误可重试但不自动重复授权。
- [ ] 重跑通过；实际浏览器验证桌面及 390px 导入/预览/资源滚动/权限错误/取消。原附件管理和单文件技能仍正常。

### Task 8: 全量验收、打包与 NAS 更新

**Files:** Modify docs/integrations/ai-skills.md、docs/backend-architecture.md；新增实际验收记录和截图，不记录密码。

- [ ] `npm test`，必须全量通过；不并行重建正在测试的 server。
- [ ] `npm run typecheck`、`npm run lint`、`npm run format:check`，逐项通过；若修复代码，重跑受影响检查及测试。
- [ ] `npm_config_prefer_offline=true npm_config_audit=false npm run pack`，核对生产依赖和官方 ZIP 版本保真。
- [ ] NAS 停服前记录所有业务表行数、user_version、运行/登记版本；SSH 停服后替换运行文件与新增生产依赖，保留 var；启动并验证 schema12、integrity_check=ok、foreign_key_check=0、旧数据未少、服务 running、关键 API 200/未授权 403。
- [ ] 用独立临时数据与测试技能验证导入/读取/准备/version/help；不执行破坏操作、不请求真实模型或擅自完成浏览器授权；真实 OAuth 未完成就明确记录未验收该项。
- [ ] 文档记录实际测试数量、部署时间、文件摘要、数据库迁移及剩余实机限制；清理隔离夹具，向用户报告运行版本和应用中心登记版本分别是什么。

## 计划自检

已覆盖规格的导入、资源读取、脚本保真、SQLite/文件生命周期、审核/静默、SSH 环境、OAuth、UI、历史恢复、取消和保留数据部署。五项 Review Focus 分别在任务 2、3、3、5、6 有对应失败回归。实施按 1→8 顺序推进，任务 7 只消费前序契约；不新增脱离 SSH 的 AI 模式或专用业务操作目录。

## 实施收尾（2026-10-23）

任务1—8的代码、全量验证、打包及保留数据NAS部署已完成；逐项实际结果以 docs/integrations/ai-skills.md 最新验收段为准。独立审查的OAuth恢复和迟到SFTP回调问题均补回归修复。生产浏览器确认内联导入、附件详情及关键菜单；README与五篇攻略更新配图。真实OAuth和真实模型工具调用仍未在生产账号执行，不记为已验证。
