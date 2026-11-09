# Execution ledger — plan: 2026-10-20-backend-sqlite-hardening.md

- Design and implementation plan approved; implementation in current session.
- Ruling: directory is not a Git repository; edit in place and retain filesystem snapshots, no Git bookkeeping commands or invented commits.
- Pre-flight: Tasks 2–5 consume the schema/provider from Task 1; row types and converters live alongside schema/repositories to prevent mismatched column mapping.
- Pre-flight: Task 6 must preserve existing frontend request values while rejecting unknown input; use explicit DTOs per endpoint rather than a permissive global body dictionary.
- Pre-flight: Task 7 removes the v1 runtime adapter only after all business consumers have moved; v1 imports remain isolated in the upgrade tool.
- Task 1: in progress. New schema and migration tests precede implementation.
- Task 1 foundation: schema/transaction/isolated upgrade implemented; six new tests pass. Full suite after initial icon repositories: 204/204 passed (`/tmp/sqlite-v2-foundation-suite.log`). New schema not yet wired into runtime.
- Ruling: build new repositories before switching the shared runtime provider, so old and new schema adapters are never mixed in one deployed runtime. Task 1 provider integration and Task 2 consumer integration remain pending until all repositories are ready.
- Backup: `/tmp/nas-manager-before-v2/source-20261020.tgz` contains local source snapshot; NAS production remains untouched.
- Tasks 2–5: repositories implemented and wired into runtime; old backend/database.ts removed. TaskEngine now writes task/run changes directly, no snapshot persistence. Scans use generation publication and 400-operation batches with event loop yields; all tested repository scenarios passed.
- Task 6: concrete DTOs and ValidationPipe connected to HTTP JSON mutation routes. Added class-validator/class-transformer to production package config. Unknown errors now return generic 500; expected domain errors carry explicit status.
- Task 7: strict:true enabled, false overrides removed; unknown catch values narrowed via errorInfo; installed actual ssh2/ws type packages.
- Ruling: device removal must preserve scheduled target identity and continue reporting missing devices, per existing real behavior tests. task_devices.selected_device_id retains historical selection; nullable device_id is the live constrained reference, cleared transactionally on removal. New missing selections remain rejected.
- Ruling: folder-only connection update now rejects unknown fields (400), replacing silent discard of forged host/credential fields; API test asserts rejection then a valid folder-only move.
- Ruling: useDefineForClassFields:false prevents absent DTO fields becoming own undefined properties and overwriting fields on partial workspace edits. Strict type checks remain enabled.
- Latest full suite `/tmp/sqlite-v2-domain-suite.log`: 209/211 passed; two identified failures in expected domain status and partial DTO edits are under focused verification. Do not claim whole migration complete.
- Fixed both DTO/domain failures; full suite `/tmp/sqlite-v2-paging-suite.log`: 211/211 passed, strict compilation passed. Added SQL entries endpoint and frontend space result paging; route metadata now 72 endpoints.
- Native package built successfully (`/tmp/sqlite-v2-pack.log`), production dependency audit reports zero vulnerabilities. Further source changes require rebuilding package again.
- NAS rehearsal succeeded on real Node 22.18: copied production data privately to `/root/deskicons-v2-update-20261020/data-rehearsal`, independently converted live v1 SQLite snapshot. Counts: icons 1, tasks 1, runs 3, SSH 1, hosts 2, folders 3, commands 1, wake 1, scans 11, rename 0. Eight read APIs 200; SQL entries 200; one saved credential decrypts; integrity ok, no foreign-key errors; Nest closes cleanly. Production remains unchanged.
- NAS staged runtime: `/root/deskicons-v2-update-20261020/runtime`. Root SSH session 26728 alive. Transfer archive `/tmp/nas-manager-sqlite-v2-runtime.tgz`. Future tar creation must disable macOS xattrs to avoid noisy Linux extraction warnings.
- Pending: remaining query/history paging, stricter domain types and cleanup, full review, refreshed build/rehearsal and final NAS deployment. Do not present rehearsal as production deployment.

## SSH 凭据要求调整（2026-10-20）

用户明确要求明文存储和返回。v2 改用 `ssh_connections.credentials` JSON 字段；连接接口按账号返回密码、私钥和口令，编辑器回填。运行时移除 CredentialCipher，原密钥仅由离线 v1 升级工具读取，转换失败不发布目标。当前源码 211 项测试通过；补充缺失旧密钥的升级失败测试后再次验证。NAS 生产环境尚未应用本次修改。

## 顺序修复审查问题（2026-10-20）

- P1 扫描批量删除：SQLite trigger 注入第二行失败，测试先复现丢失首行，再改为整批事务、提交后更新内存；改名记录采用相同处理。
- P2 迁移目录图：循环和超过 16 层均先复现被接受，再加入升级前校验，不发布异常目标库。
- 存储持久化：删除 32 MiB/200 条隐式清理，按变更行保存，重启保留 205 条记录的回归通过。历史页面已接服务端计数、过滤、稳定排序与分页，移动端加载更多，选择数限制 200。代表查询 EXPLAIN 使用 owner/time 索引且无临时排序。
- 类型与工程：原 693 处显式 any 已清除，AST 计数为 0；具体业务类型、未知输入校验、严格编译保留。接入 ESLint、Prettier、EditorConfig 及 typecheck/lint/format:check，清理未使用代码；限制 Domain 与 Controller 依赖方向。集中校验启动配置。
- 日志与文档：未知异常记录错误类型、受限错误码与调用帧，不记录错误消息、请求正文或凭据。旧迁移脚本删除，存储与架构文档更新为 v2。
- Final review: independent reviewer found deletion/operation race, completed-before-SQL-publication, and rename interruption only in memory. All three reproduced RED, fixed with queued busy-state recheck, completion-after-commit, and persisted restart recovery. Full suite /tmp/audit-full5.log: 227/227 passed.
- Latest build/lint/typecheck/format-check passed; native package /tmp/audit-final-pack.log built successfully (production audit 0 vulnerabilities). Subsequent lazy rename detail refinement requires refreshed validation and packaging before final completion.
- Ruling: previous NAS rehearsal used earlier candidate and is not final validation. This repair request changes local code only; production NAS remains v1 until an explicitly requested deployment with fresh offline upgrade rehearsal/backup.

- Final completion of audit fix scope: rename startup now reads summaries only; detail view/undo hydrates only requested batches, unrelated 500-entry history remains unloaded. Regression RED→GREEN. Final suite /tmp/audit-final-suite.log: 228/228; lint/typecheck/format:check passed (logs /tmp/audit-final-lint2.log, /tmp/audit-final-types2.log, /tmp/audit-final-format2.log). No known deferred audit findings. Final package rebuild follows this entry. Production NAS unchanged.

- Final release verification: npm run build and npm run pack both exited 0; /tmp/audit-release-build.log and /tmp/audit-release-pack.log. Output build/deskicons/deskicons.fpk (0.2.11); packaged production dependency audit reports 0 vulnerabilities. NAS deployment not performed in this repair turn.

### 再次复查后的发布流程与数据边界修复

- 将原生服务脚本提取为 scripts/service-main.sh。停止时检查 PID，发送 SIGTERM 后等待最多 30 秒；进程退出才移除 PID，超时返回失败且保留 PID。
- npm run pack 自动执行完整前后端构建，复制本轮 dist；运行依赖使用独立固定 scripts/runtime-package-lock.json 和 npm ci，依赖不一致时停止打包。npm run lock:runtime 显式更新运行锁文件。Linux Sharp 补充归档验证锁文件 SHA-512。
- 扫描 worker 消息校验具体进度和完整嵌套结果，错误消息使任务失败而非抛出未处理异常；SSH 已存凭据按认证方式解码字段类型，明文存储与所属用户返回策略保持。
- 测试先复现停止过早返回和缺少运行锁文件，再实现修复；232/232 全套测试通过，补充的嵌套数据校验与停止行为定向复测通过。ESLint、严格类型、格式检查通过；完整 pack 成功，运行依赖审计 0 漏洞。
- 最终 FPK 位于 build/deskicons/deskicons.fpk，未部署 NAS。Vite 仍提示既有大 chunk 与混合静态/动态导入，未影响构建。

### NAS release, fresh data (2026-10-20)

User explicitly requested no backup and a clean update; data reset was explained. Stopped deskicons and verified its old Node process exited. Verified canonical target/data paths; cleared only /vol1/@appdata/deskicons, replaced runtime, dependencies, frontend, and cmd/main; retained app registration/UI configuration. Initialized SQLite v2, integrity_check=ok, foreign_key_check=0. appcenter-cli start succeeded, NestJS socket log confirmed, version 0.2.11. On NAS: state, entries, tasks, SSH connections/workspace (scope assets and commands), paginated scan/rename histories, wake devices, task-capabilities, containers, official/status returned 200. Saved lists empty, Docker returned 11 containers, official authorization disconnected. Missing gateway identity returned 403; frontend HTML returned 200. No NAS reboot, remote power commands or user-file mutations performed.

### Empty-state frontend update on NAS

Unified the four create-item empty states with shared rendering and styling, consistent plus-icon actions, no-match copy and no first-item action on filtered results. Hide task pagination when results are empty. Lint, formatting and build passed; browser preview checked task/SSH/wake layout. Deployed dist only to NAS, preserving current data and backend. Served index SHA256 matches local 0b6ac8d47c8bd3879d61b543f9a97315a772b1283f7914176650c520e9164943; referenced JS/CSS/image all HTTP 200. Five menu list APIs verified HTTP 200 after deployment. Reopen or refresh the app to load the new assets.

### SSH UI and session-only transfer tracking (2026-10-21)

- Added reusable password visibility control to the connection editor, reset to concealed on form reset. Removed its three explanatory lines; body/footer shrink naturally using shared styles.
- Removed the monitor-only 300px override; assets, commands, transfers and monitor share 240px desktop panels and existing mobile sheet geometry.
- Added file transfer navigation above monitor, active count badge, one-row filename/direction/size/status. Completed and failed use check/cross; path/time no longer occupy rows. Backend records real SFTP upload/download byte progress and outcome, isolated by owner + live SSH session. Closing transport sessions clears memory without resurrection from late callbacks.
- User superseded the initial persistent-100 history choice with current-session-only history. Removed unreleased SQLite table/migration/repository and persistence tests; production remains schema v2. No persistence candidate was deployed.
- Shortcut commands append exactly one Enter; multiline confirmation remains intact. 234/234 tests passed, including real SFTP HTTP transfers, owner/session isolation, cleanup and command newline behavior; lint/typecheck/format/build/pack passed. Final UI size/status-symbol update was linted and fully repackaged. Browser preview checked compact rows, editor spacing, password toggle, menu placement, badge and mutual panel switching via semantic locators.
- NAS update preserves business data: before/after counts icons=0, tasks=0, SSH=1, wake=0, scans=1; SQLite integrity ok. Final runtime archive includes server, frontend and matching runtime manifests; no dependency changes. App restart verification follows.
- AI assistant is separate pending design work: docs/superpowers/specs/2026-10-21-terminal-ai-design.md. User confirmed custom compatible endpoint/key/model and per-command confirmation; written design review is pending.
