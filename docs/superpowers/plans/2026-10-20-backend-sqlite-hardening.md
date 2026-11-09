# 后端与 SQLite 完整迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用具备业务表、关系约束和类型校验的 NestJS 后端替换过渡存储实现，保留 NAS 数据并完成更新。

**Architecture:** 单一 Nest Express 运行时注入 DatabaseService 与各业务 Repository。显式 SQL 管理 schema，旧库仅由独立升级工具读取；服务端查询取代完整集合快照持久化。按业务模块逐个迁移后统一启用 strict。

**Tech Stack:** 当前 NestJS 12.2、TypeScript 5.9、Express 5、Node 22 SQLite；DTO 使用 class-validator/class-transformer。

**Spec:** `docs/superpowers/specs/2026-10-20-backend-sqlite-hardening-design.md`

## Global Constraints

- 当前会话内直接实施；不主动启动子代理；目录没有 Git 仓库，不初始化 Git 或假报提交。
- 五个菜单功能、共享 UI、现有 ID、用户隔离和已加密凭据保留。
- 新运行时移除 readData/writeData、旧 .json 路径适配及通用 payload 文档表。
- 旧库转换独立执行；迁移失败保留源库；不静默跳过异常记录。
- server/ 为生成目录；backend/ 为 Node 后端 TypeScript 源；Python 文件工具继续作为功能实现。
- 未完成全部验证前，不把过渡版本替换到 NAS。
- 不使用 appcenter-cli install-local 更新已安装应用；不测试 NAS 重启、设备关机或删除用户实际文件。

## Review Focus

1. SSH 与网络唤醒关联涉及不同用户时必须拒绝，分类目录也不能跨用户关联。
2. SQLite 锁等待、磁盘写入失败时，不提前返回成功或让内存状态偏离数据库。
3. 升级重跑、已有异常引用或更新版 schema 必须有明确结果，不破坏原库。
4. 扫描结果较多时分页不可遗漏同大小、同时间的记录，SSH 交互不被长事务持续阻塞。
5. 请求异常与运行日志不能包含私钥、密码或令牌；二进制流不能进入 JSON 校验。

## Task 1：数据库基础与隔离升级工具

**Files:** 新建 `backend/persistence/{database.service,schema,transaction}.ts`、`backend/persistence/migrations/v2.ts`、`backend/upgrade/v1-to-v2.ts`、`scripts/upgrade-database.js`、`tests/sqlite-schema.test.js`。修改 `backend/app/common/common.module.ts`。

**Interfaces:** DatabaseService 管理连接、`transaction<T>(work: () => T): T` 和 `close(): void`；升级工具 `upgradeDatabase(sourcePath: string, destinationPath: string): Promise<UpgradeReport>` 返回源/目标版本、逐表数量与验证结果。目标库必须是新文件。

- [ ] 写测试：空库创建 STRICT schema；NULL 主键、非法端口/布尔值被拒绝；更新版 schema 拒绝启动；事务中第二步失败后第一步不落库。
- [ ] 运行 `npm run build:server && node --test tests/sqlite-schema.test.js`，确认缺少实现导致失败。
- [ ] 实现连接级外键、WAL、FULL 同步、busy_timeout 与版本校验；迁移编号使用 schema_migrations；不在业务启动时导入旧 JSON。
- [ ] 升级读取源库快照，按依赖顺序转换，保留 ID，将旧凭据解密为明文，发现异常引用时报告记录 ID；使用新目标文件完成转换后再输出成功报告。
- [ ] 增加测试：v1 转换完整性、源库不变、失败不发布目标、重复执行拒绝覆盖目标、凭据明文内容一致与缺失密钥时不发布目标；执行 integrity_check 与 foreign_key_check。
- [ ] 运行新测试和原有 SQLite 测试，修正旧测试只针对独立升级工具的部分；不删除数据保护断言。

## Task 2：图标与官方连接持久化

**Files:** 新建 `backend/persistence/{icon.repository,official.repository}.ts`、`backend/domain/icons.ts`；修改 `backend/store.ts`、`backend/tasks/official.ts`、`backend/app/icons/{icons.service,icons.controller}.ts`；新增 `tests/repositories-icons.test.js`。

**Interfaces:** IconRepository 提供 `list()`、`find(id)`、`save(entry)`、`remove(id)`；OfficialRepository 提供 `get()`、`save(connection)`；参数与结果使用明确领域类型。

- [ ] 添加图标修改失败不改变原记录、更新时间/修订号往返、官方授权状态往返测试并确认失败。
- [ ] 定义图标字段与明确的 official_connection 列，Repository 执行行级写入；移除 Store 的快照回写和旧逻辑文件路径。
- [ ] 控制器保留当前共享权限语义；业务对象类型贯穿图标校验、图标生成及保存流程。
- [ ] 运行 `npm run build:server && node --test tests/core.test.js tests/repositories-icons.test.js`；存在不同原测试文件名时按功能选取当前 tests 文件，记录实际命令。

## Task 3：SSH、分类与网络唤醒关系

**Files:** 新建 `backend/persistence/{terminal.repository,workspace.repository,wake.repository}.ts`、`backend/domain/{terminal,wake}.ts`；修改 `backend/terminal/{store,workspace-store,credentials}.ts`、`backend/wol.ts`、`backend/wake-power.ts` 与对应 Nest providers；新增 `tests/repositories-terminal.test.js`。

**Interfaces:** TerminalRepository 按 owner 查询/修改连接和 known hosts；WorkspaceRepository 管理目录/指令；WakeRepository 管理设备。删除连接与解除设备绑定使用同一数据库事务。

- [ ] 写测试：外键与 owner 不匹配被拒绝、known host 组合唯一、非空分类拒删、分类循环拒绝、SSH 删除解除设备绑定且不会解除其他用户数据。
- [ ] 实现 ssh_folders/ssh_commands/ssh_connections/ssh_known_hosts/wake_devices，明确可空外键与唯一性；分类 scope 和 kind 不再混放为未约束文档。
- [ ] 替换数组写回，连接及目录操作从 Repository 读写；按用户最新要求直接明文存储并向当前账号返回凭据，运行时移除凭据加密逻辑。
- [ ] 将凭据错误、并发写失败与事务回滚加入测试；运行终端、文件管理、workspace、唤醒和设备任务相关现有测试。

## Task 4：任务与执行记录

**Files:** 新建 `backend/persistence/task.repository.ts`、`backend/domain/tasks.ts`；修改 `backend/tasks/{engine,model,network}.ts`、`backend/app/tasks/{tasks.service,tasks.controller}.ts`；新增 `tests/repositories-tasks.test.js`。

**Interfaces:** TaskRepository 提供任务列表/查询/写入、设备关联写入、执行记录追加/更新及分页；TaskEngine 仅缓存正在执行的作业，数据库为持久化事实来源。

- [ ] 测试任务和设备关联原子提交、运行中禁止删除、删除任务同时删执行记录、不同 owner 的设备不能绑定。
- [ ] 实现 tasks/task_runs/task_devices，明确任务状态及调度字段，变体参数仅保存必要 JSON；保留原调度与执行算法。
- [ ] 执行记录的状态迁移和 nextRunAt 更新采用短事务；启动时处理中断记录，不恢复为自动重复执行。
- [ ] 测试重启恢复、并发执行限额、状态写入失败和历史分页稳定排序；运行调度及设备联动测试，不触发真实电源操作。

## Task 5：扫描与改名历史、服务端分页

**Files:** 新建 `backend/persistence/{scan.repository,rename.repository}.ts`、`backend/domain/storage.ts`；修改 `backend/storage/{service,duplicates,rename,worker}.ts`、`backend/app/storage/storage.controller.ts` 与前端存储 API 调用；新增 `tests/repositories-storage.test.js`。

**Interfaces:** `PageQuery { page:number; pageSize:number; sort:StorageSort; direction:'asc'|'desc' }`，`Page<T> { items:T[]; total:number; page:number; pageSize:number }`；ScanRepository 分别保存摘要、分批明细、重复组与副本；RenameRepository 保存批次/逐项结果。

- [ ] 添加所有权隔离、明细级联删除不触碰文件、同大小/同时间分页稳定性、未知排序字段拒绝和结果较大时批次提交测试。
- [ ] 拆分 scans/scan_entries/duplicate_groups/duplicate_members 与 rename_batches/rename_items，保留现有扫描边界和文件安全检查。
- [ ] 历史列表和结果明细使用 SQL WHERE/ORDER BY/LIMIT/COUNT；索引匹配 owner、scan_id 与排序列，增加 ID 决定同值排序。
- [ ] 前端使用服务端分页结果，移动端无分页控件的视图按当前交互加载数据；轮询读取摘要，按需要拉取结果，不重复返回整份目录清单。
- [ ] EXPLAIN QUERY PLAN 检查代表查询；运行存储扫描、重复处理和批量改名测试；计时测量大结果查询期间终端响应，不虚构性能结论。

## Task 6：请求 DTO、异常与配置

**Files:** 新建各 `backend/app/<menu>/dto.ts`、`backend/app/common/{validation,config}.ts`；修改 bootstrap、各 controller、common/errors；新增 `tests/api-validation.test.js`。

**Interfaces:** DTO 使用具体 class 和运行时校验；HTTP 未验证输入为 unknown；业务错误携带明确状态，未知错误走 500；二进制上传流使用独立路径。

- [ ] 写测试：未知字段、过长名称、错误布尔值、非法端口、过大数组和分页越界均拒绝；JSON 解析前仍先认证/CSRF。
- [ ] 接入 ValidationPipe，逐路由用 @Body DTO/@Query DTO；提取原有安全校验供业务继续调用，避免内部任务绕过权限边界。
- [ ] 验证启动端口、目录和运行选项；未知异常返回通用信息，日志记录可定位上下文并屏蔽认证数据。
- [ ] 运行 API 校验、安全、WebSocket 和二进制传输测试，确认流式上传下载未被缓冲/转换。

## Task 7：严格类型与旧实现清理

**Files:** 修改 `backend/**/*.ts`、`tsconfig.server.json`、构建/打包脚本；删除 `backend/database.ts` 旧通用适配；更新 `docs/sqlite-storage.md` 和后端架构说明。

**Interfaces:** 全部 Node 业务模型为具体类型；外部边界为 unknown 与类型守卫；SQLite 驱动通过 provider 注入，生命周期在任务和工作进程停止后关闭。

- [ ] 运行严格编译获取实际错误清单；按模块修复，禁止 ts-nocheck、全局 any 字典或关闭 strict 子项绕过。
- [ ] 移除仅为旧数组/doc 形状服务的字段、方法与路径；旧转换代码只留在 upgrade 工具，不被 bootstrap 导入。
- [ ] 更新资源关闭顺序，测试反复启动关闭不会重复启动调度器或遗留 SSH/工作线程。
- [ ] 运行 `npm test`、`npm run build`、`npm run pack`；检查产物没有旧 HTTP 路由或 JSON 存储实现。

## Task 8：NAS 数据演练与部署

**Files:** 新增本次验证和更新记录，包含实际命令结果与备份路径，不包含密码/令牌。

- [ ] 使用 NAS 一致性数据库副本，运行新升级工具；对照所有业务记录、引用、ID 和凭据解密，执行完整性检查。
- [ ] 在隔离目录启动新 Nest 服务，逐菜单验证读取与测试数据写入，检查权限、关停和后台作业恢复。
- [ ] 保留可恢复的代码、数据库和密钥备份；停应用后执行正式转换，替换运行目录及目标库后启动。
- [ ] 验证五个菜单、数据计数、数据库完整性、任务调度和运行版本；失败立即恢复同版本代码与数据。
- [ ] 记录实际测试结果、已更新的 NAS 版本与已知限制，仅完成全部步骤后声明迁移完成。

## 执行顺序

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。数据库基础先行；每个业务模块完成其测试后再进入下一个。当前会话内实施，无需新建聊天或启动子代理。
