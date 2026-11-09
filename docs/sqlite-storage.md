# NAS 管家 SQLite 存储

当前运行版本为 0.2.53 / schema v18，共 37 张表（含 schema_migrations）；应用中心登记版本仍为 0.2.52。v17 新增设备 IP 和可达性观察记录。附件原文件仍存放应用数据目录，数据库不保存附件正文。下文保留表结构历史；旧业务字段及数据保持不变。

数据库位于 `$DATA_DIR/nas-manager.sqlite`，飞牛通常为 `/vol1/@appdata/deskicons/nas-manager.sqlite`。运行时使用 Node.js 内置 `node:sqlite`，NAS 已验证 Node 22.18.0 / SQLite 3.50.2。数据库文件权限为 0600，启用 WAL、FULL 同步、5 秒锁等待和外键检查。

## v3 表结构

业务字段使用独立列，所有表采用 STRICT，主键显式 NOT NULL。名称长度、状态、布尔值、端口、大小等通过 CHECK 约束；关联同时包含所属账号，防止跨用户引用。应用日期列使用 UTC 毫秒整数；文件修改时间 `scan_entries.modified_at` 保留扫描器的数值精度。

| 表 | 内容与关键关系 |
| --- | --- |
| `icons` | 名称、URL、打开方式、容器 ID、来源、修订号、已应用修订号、排序 |
| `ssh_folders`、`ssh_commands` | 用户分类目录和指令；父目录关联限定同用户、同 scope |
| `ssh_connections` | 用户、连接类型、主机、端口、用户名、认证方法、认证内容、分类目录 |
| `ssh_known_hosts` | 用户、主机、端口、算法组成主键，保存公钥和指纹 |
| `wake_devices` | 用户、MAC、广播地址、端口、系统、关联 SSH 连接、最近唤醒和电源操作时间 |
| `tasks` | 任务名称、类型、用户、启用状态、调度、专属参数、超时和下次执行时间 |
| `task_devices` | 任务与设备关联、原选择设备 ID、电源目标快照；设备移除后保留原选择以便执行时报告失败 |
| `task_runs` | 任务外键、任务名称、触发来源、执行状态、时间、退出码、输出、逐设备结果；随任务删除 |
| `scans` | 用户、扫描模式、路径、状态、统计、当前结果 generation |
| `scan_entries` | 扫描结果的 catalog、largestFiles、topDirectories、extensions 明细，按 generation 分组 |
| `duplicate_groups`、`duplicate_members` | 重复组摘要与逐文件路径；关联扫描和 generation |
| `rename_batches`、`rename_items` | 改名或撤销批次、状态、逐文件结果；删除历史不触碰实际文件 |
| `official_connection` | 单行官方授权连接元数据；OAuth session 由官方 CLI 保存在文件中 |
| `ai_settings` | 用户主键、兼容 API 地址、模型、API Key 与 UTC 毫秒更新时间；STRICT，按账号隔离 |
| `schema_migrations` | 已应用 schema 版本和时间；当前 `PRAGMA user_version=3` |

v3 没有通用 `documents` 表或整条业务记录的 `payload` 列。JSON 仅用于具体业务内的变体或细节：任务调度和专属参数、设备目标快照、逐设备执行结果、扫描统计和明细补充字段、改名补充信息，以及 SSH 认证结构。JSON 不是同一对象的第二份完整存储。

Repository 直接按行查询、保存和删除；任务执行记录、扫描历史及结果明细提供 SQL 计数、排序和分页。索引覆盖所属账号、父目录、到期任务、执行历史和扫描结果排序。排序字段使用白名单，查询值使用绑定参数。扫描结果按 generation 发布，避免分页读取到半份新结果。业务事务必须同步且短暂，扫描、哈希、SSH 和文件操作在事务之外执行。数据库写失败会回滚，不提前返回成功。

## 凭据与外部文件

按已确认的产品要求，SSH 密码、私钥和口令以**明文 JSON**保存于 `ssh_connections.credentials`，当前用户的连接接口会返回其已保存认证内容。运行时不使用 `terminal/credential.key`，也不保留新旧两套凭据实现。数据库副本及停机备份都包含这些认证信息，应沿用受限目录和文件权限。

独立升级工具遇到 v1 旧密文时读取源数据库同目录下的 `terminal/credential.key`，完成解密和结构验证后写入新结构；密钥缺失、解密失败或记录无效都会终止转换，不发布目标库。

图标 PNG 已在 v6 迁入 SQLite BLOB。官方 CLI session 由官方程序自行管理，应用日志由系统管理；二者不作为本应用的第二套业务存储。活动 SSH/WebSocket 会话、任务中断控制器、临时改名预览，以及按用户要求随会话清空的传输记录属于运行状态，不持久化。

## 启动与离线升级

日常启动接受 v3；全新空目录初始化 v3。v2 在一个事务内新增 `ai_settings`、登记迁移并将 user_version 更新为 3，不重写旧表。遇到 v1、较新版本、含表但未标记版本的库会阻止启动。未建立库但发现已知旧 JSON 文件时也会阻止初始化，避免把旧数据误判为空目录。运行时不自动导入 JSON，不自动升级 v1。

独立入口为：

```sh
node scripts/upgrade-database.js /backup/data-v1/nas-manager.sqlite /staging/data-v2/nas-manager.sqlite
```

在源码目录先运行 `npm run build:server`，因为脚本导入编译后的 `server/upgrade/v1-to-v2.js`。源必须是 `user_version=1` 的 SQLite；若原认证内容仍加密，保留 `/backup/data-v1/terminal/credential.key`。目标必须是新的路径，工具绝不覆盖已有目标。

升级过程只读打开源库，通过 SQLite backup 创建一致性快照，在目标目录的临时目录中建立当前版本，单个事务转换各业务与关联，检查目录循环、所属账号和字段，然后执行 `foreign_key_check` 与 `integrity_check`。成功后 checkpoint、关闭连接，再以独占文件链接发布 0600 目标库；失败清理临时产物，源库不变。输出报告包含源/目标版本和各业务数量。工具只处理 v1 → 当前版本，旧 JSON 原始迁移属于历史流程。

正式升级步骤：

1. 完成本地类型检查、静态检查、格式检查、回归测试和构建，使用最终代码重建发行包。
2. 在 NAS 数据一致性副本上演练独立升级，对比记录数量、ID、重要字段、关联和凭据内容。不要在日志中打印密码、私钥或令牌。
3. 停止正式服务，确认进程和数据库连接关闭，完整备份实际运行代码目录与 DATA_DIR。运行期间需要备份时使用 SQLite backup，不能仅复制主文件而遗漏 WAL。
4. 从停机备份再次转换出正式候选库，核对报告、schema 版本、完整性和外键。替换运行代码和数据库时保留相互对应的回退副本，旧 WAL/SHM 不得与新主库混用。图标和官方 session 一并保留。
5. 启动后检查五个菜单、用户隔离、读取接口、分页排序、任务状态和官方只读接口；需要验证 SSH 时核对已保存认证及主机指纹。正式验收不执行 NAS 重启、设备关机或删除用户文件。
6. 失败时停止新服务，恢复同一停机快照的代码、完整数据和外部文件，再启动旧版本；保留失败候选库用于诊断。

此 NAS 上 `appcenter-cli install-local` 曾在升级已安装应用时先卸载后失败，并删除应用数据目录，**禁止再使用该路径升级既有应用**。不得通过删除数据库来触发旧 JSON 重导入。

## 验证与部署记录

2026-10-20 本轮修复的本地全套回归为 228/228 通过，lint、typecheck、format:check 均通过。已补齐批量事务、目录图校验、存储按行写入、SQL 历史分页、明细延迟加载、完成后发布状态、重启恢复、诊断日志和工程规范。之前完成过 NAS v1 副本转换及只读接口演练，但旧演练不替代最终代码的 NAS 验收。构建与部署状态以执行记录 `docs/superpowers/plans/2026-10-20-backend-sqlite-progress.md` 为准。该段是历史验收记录：v2 随后已按用户要求清空部署。

保留的历史恢复位置：v1 上线前停机备份 `/root/deskicons-sqlite-update-20261020/data-before`，JSON 版本实际代码副本 `/root/deskicons-sqlite-update-20261020/json-version-code`；v2 演练目录 `/root/deskicons-v2-update-20261020/data-rehearsal`，暂存运行代码 `/root/deskicons-v2-update-20261020/runtime`。这些路径是历史证据，部署前须重新核对内容和时间，不把软链接视为独立代码备份。

Deployment update (2026-10-20): schema v2 is now deployed on NAS. At the explicit user request, all application data was reset with no new backup and no v1 migration. Earlier statements about pending deployment are historical.


## AI 配置与临时会话

AI API Key 明文保存在受限的 0600 数据库中，读取设置接口只返回 `baseUrl`、`model`、`hasKey`。空白 Key 更新保留原 Key；新建设置支持无认证本地服务。聊天消息、提议、确认状态与执行输出只保存在服务内存中，关闭 SSH 会话即清空；不会新增聊天历史或文件传输历史表。v2 → v3 为事务性增量升级，失败不会登记完成状态。

2026-10-21：0.2.12 / v3 已完成 NAS 正式更新。增量迁移后旧业务表数量全部与更新前相同，完整性及外键检查通过，数据库权限0600；新 AI 设置为空，等待用户配置模型服务。


## schema v4（0.2.13，本地待发布）

v3→v4在事务中将 `ai_settings` 迁移到 `ai_providers` 并移除旧表；新增 `ai_chats`、`ai_chat_messages`、`ai_chat_proposals`、`ai_chat_protocol`。各表STRICT、所属账号限定、外键级联明细清理。工具调用参数保存在具体tool_calls JSON列，其余字段使用独立列。供应商凭据不进入对话/协议历史，公共配置只返回hasKey。

历史按账号保留50个对话，保护活动绑定，并自动删除较旧非活动对话。恢复不重放旧命令，一个聊天只能由一个活动SSH使用；刷新、服务重启后可读取历史。v2仍可经v3迁移阶段自动进入v4，原SSH/扫描/任务表不重写。NAS仍为v3，本轮未部署。


2026-10-21：0.2.13/v4 已正式部署NAS。v3→v4成功；原SSH连接1、扫描1、扫描明细9223、重复组32/成员64及其他业务表数量全部与更新前一致。数据库0600，integrity_check=ok，foreign_key_check为空。正式AI配置与历史均为空，未导入本地测试数据。此前“本地待发布”标记已完成。


## v6：命令库、用户偏好和图标图片

- `command_catalog`：命令 ID 主键、所属用户、命令文本、中文说明、分类、排序和时间；同用户内命令文本唯一。173 条初始数据仅在每个用户首次访问时写入，之后的编辑和删除不会被重启覆盖。运行时接口和命令提示统一查询该表，前端不再内置命令数组。无需每个按键请求服务器，加载后的内存副本仅用于当前页面匹配。
- `user_preferences`：用户主键、主题（system/light/dark）、命令提示开关、命令库初始化标记、更新时间。布尔和主题采用 CHECK 约束；更新只修改提交字段，用户之间隔离。前端不再使用 localStorage/sessionStorage/IndexedDB 保存偏好。
- `icon_images`：图标 ID 主键和 PNG BLOB，外键关联 `icons`，删除图标时级联删除图片；元信息和图片在同一事务内保存。PNG 大小上限 2 MiB，图片接口和桌面安装/导出从数据库读取。

v5 升 v6 使用事务新增表，并将已有图标 PNG 导入 BLOB；事务提交后只清理与数据库字节完全相同的旧文件。失败不提前删除源图片，运行时不保留文件读取回退。首次主题默认跟随系统，以后在数据库按用户保存。所有现有业务记录保留。

范围审计：应用自己的持久业务对象统一使用 SQLite。程序代码、初始数据库种子、随包品牌图片、生成桌面应用所需临时 FPK、官方 CLI 的会话存储，以及系统日志保留各自正常的文件职责；不会把这些程序或外部工具文件伪装成业务表。终端缓冲、输入候选、正在执行的进程和仅当前 SSH 会话有效的传输状态仍留在内存。

常用命令菜单位于终端工作区系统监控上方，支持分类和命令/参数/中文说明搜索，搜索与分类在同一行。顶部齿轮保存提示开关，旁边加号新增命令，右键或移动端长按可编辑、删除。菜单点击与输入候选均只填入命令，不自动发送回车。普通 Shell 行尾识别失败时不填入；不会把命令插入密码输入或全屏程序。主机需自行具备相应工具，内置库不是工具安装清单。

命令参数参考：[Docker CLI](https://docs.docker.com/reference/cli/docker/container/ls/)、[systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)。


## v7 系统设置

`user_preferences` 新增 `default_page`（icons/tasks/terminal/storage/wake，默认 icons）和 `navigation_motion`（0/1，默认 1），沿用用户主键、STRICT 与 CHECK 约束。v6 升级通过同一事务添加两列并追加迁移记录，保留主题、命令提示、命令库初始化状态及业务记录；总表数仍为25张（包含schema_migrations）。设置接口按当前账号读取，PUT仅更新提供字段，沿用管理员和CSRF校验。默认页面只决定初次显示，不建立SSH连接。主题跟随系统时接受飞牛或操作系统主题变化，指定浅色/深色时不被系统事件覆盖。


## v9 AI 附件元数据

新增 STRICT 表 `ai_chat_attachments`，记录账号、聊天、消息、协议位置、文件名称、类型、大小、UUID 存储标识及 SHA-256，外键级联到聊天消息和协议记录。原文件位于 `$DATA_DIR/ai/attachments`，采用权限受限的独立文件；最近 50 个对话淘汰时清理无引用附件。详情见 [AI 聊天附件](integrations/ai-attachments.md)。已有 v8 记录增量保留。


## v10 附件清理

`ai_chat_attachments` 增加 `created_at` 和可空 `deleted_at`，清理保留元信息墓碑，查询索引覆盖所属账号、存活状态及创建时间。旧附件创建时间从所属聊天更新时间初始化。清理后正文不再加入模型上下文，聊天可恢复且只显示“已清理”；存储管理可按名称、类型和时间分页清理。总表数仍26张，schema9→10事务迁移保留原行及附件文件。


## v11 AI 技能配置

新增 STRICT 表 `ai_skills`，按账号保存name/description/instructions、许可和兼容字段、元数据JSON、allowed-tools声明、启用状态及时间。同账号名称唯一，启用值与字段长度受CHECK约束；索引覆盖账号、启用和名称。技能定义属于应用配置，与附件文件存储分离。schema10→11仅增表及迁移记录，原业务表和附件文件保持；详见[integrations/ai-skills.md](integrations/ai-skills.md)。

## schema v14：配置备份与恢复

新增 `backup_receipts`，按账号与请求 ID 保存恢复请求摘要、配置包摘要、选择摘要、结果和时间，保证重复提交不重复导入。`tasks.pending_reason` 保存恢复后需要重新确认的原因，执行与启用入口均检查该状态。v13→v14 事务迁移保留旧记录。导出的 JSON 仅为交换文件，配置持久化仍使用 SQLite。

2026-10-23 NAS 验收：31 表，原业务记录数量未变，完整性检查 ok、外键错误 0；临时账号恢复及幂等测试通过，测试配置与回执已清理。

## schema v15：通用 Webhook 通知

新增 `notification_settings`，按账号保存地址、认证 Token、启用状态、条件和配置修订号；新增 `notification_deliveries`，记录唯一事件、摘要、修订号、尝试次数、下一次投递时间和状态。两表均 STRICT，主键非空，字段 CHECK 约束；投递表外键关联所属设置，按状态/到期时间和所属账号建立索引。任务和扫描的最终状态与通知入队在同一事务中持久化，不存储脚本、输出和扫描路径。v14→v15 保留已有记录，新配置默认关闭。

## schema v16：统一操作记录

新增 `operation_records`（账号、动作、目标摘要、状态、开始/结束时间、结果摘要）与 `operation_settings`（每账号保留上限），均为 STRICT 表。动作、状态和保留数量受 CHECK 约束，按账号和开始时间建立索引。进行中记录不修剪，启动时未结束记录标为中断。v15→v16 保留原数据，旧操作不追溯生成记录。


## schema v17：设备状态检测

`wake_devices.ip` 保存可选的检测用 IPv4，与广播地址独立；`wake_presence` 以设备 ID 为主键并级联删除，保存目标身份、状态、原因和检查时间。状态与原因使用 CHECK 约束，表为 STRICT。升级保留已有设备；配置备份包含 IP，不包含观察记录。过期观察显示未知，服务启动不恢复唤醒后的复查定时器。

## schema v18：在线编辑版本

源码新增 STRICT 表 `text_file_versions`，保存所属账号、连接外键、目标身份摘要、时间、大小、编码、BOM 和内容校验摘要。连接删除级联清理索引；正文为应用数据目录 `editor-versions` 中的私有文件，启动及捕获时清理孤立文件。已在 NAS 完成迁移验收，共 37 张表；完整性检查为 ok，外键检查无错误，已有业务表记录数保持不变。

任务重试和错过执行策略沿用 SQLite `tasks.options`，配置导入导出包含两项设置，导入任务仍默认暂停。扫描对比读取已有记录，不新增表；连接诊断、AI 步骤和传输队列为会话临时状态。
