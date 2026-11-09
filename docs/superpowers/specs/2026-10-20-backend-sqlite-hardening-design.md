# NAS 管家后端与 SQLite 完整迁移设计

日期：2026-10-20。状态：用户已批准，结构改造与最终工程验证进行中；schema v2 尚未部署 NAS 正式环境。当前实现说明见 `docs/backend-architecture.md` 和 `docs/sqlite-storage.md`。

## 目标与边界

继续完成已经确定的前端 + NestJS / TypeScript + Express adapter + SQLite 架构。五个菜单的功能、共享 UI、已有配置、历史记录、用户隔离和凭据必须保留。新运行时不再包含旧 Express 路由、JSON 文件存储接口或双轨存储。旧数据转换放入独立、一次性升级工具，日常启动只使用新数据库结构。

本轮集中于后端和数据访问；前端只调整服务端分页所必需的请求处理，不重新设计页面。保留用于文件操作的 Python 工具，它们不是旧后端兼容层。

## 改造前审查发现

- `backend/database.ts` 的业务表仅有 id、owner、position、payload，关联和查询字段基本都在 JSON 内。
- `readData/writeData` 仍按 `.json` 逻辑路径读取完整集合；索引与实际过滤、分页未形成配合。
- 文本主键缺少显式 NOT NULL；开启 foreign_keys 并未产生实际外键约束。
- `tsconfig.server.json` 关闭 strict，业务代码有大量显式 any。
- Nest 模块、控制器与生命周期已经接入，但请求仍普遍由 req.body 进入动态业务模型。
- 异常过滤器把未知异常默认为 400，且可能向客户端返回内部异常信息。
- SQLite 事务、WAL、FULL 同步及权限设置已有基础，可继续使用。

上述属于本项目的审查结论，不是声称官方存在唯一的目录或表命名规范。

## 方案选择

选用 Nest 注入的 SQLite provider + 业务 Repository + 显式 SQL 迁移。Nest 官方允许直接使用数据库驱动，并不强制 ORM。

另外两种方案：仅为 payload 添加索引改动较小，但仍保留原存储模型；引入完整 ORM 可提供实体与迁移工具，但增加驱动和打包适配工作。当前项目已在 NAS Node 22 上验证 SQLite 驱动，优先完善现有驱动之上的类型和关系设计。

## 数据结构

所有新业务表采用 STRICT，主键显式 NOT NULL；布尔值使用 INTEGER CHECK IN (0,1)，端口与大小有范围检查。时间统一存 UTC 毫秒整数，由界面按现有时区格式化。保留现有 ID，不重新生成关联标识。允许空值的字段明确使用 NULL，不以空字符串代替未设置。

| 业务 | 表及职责 |
| --- | --- |
| 桌面图标 | icons：名称、地址、来源、打开方式、图标引用、排序和时间为列 |
| 计划任务 | tasks：类型、启用状态、调度与时间；task_runs：任务关联、触发方式、状态、时间、退出码与输出 |
| SSH | ssh_folders、ssh_commands、ssh_connections、ssh_known_hosts：分类、指令、连接、主机密钥分表 |
| 网络唤醒 | wake_devices：MAC、广播地址、端口、系统、所属用户、关联 SSH 连接；task_devices：设备任务的关联表 |
| 存储管理 | scans、scan_entries、duplicate_groups、duplicate_members：摘要与结果明细分开；rename_batches、rename_items：改名批次和逐文件结果分开 |
| 系统配置 | official_connection：官方授权元数据；schema_migrations：已应用迁移编号和时间 |

调度的具体参数、不同任务类型的专属选项及扫描统计等可保留经过验证的 JSON 字段；参与过滤、排序、关联的字段必须有明确列。不得保存同一业务对象的完整 JSON 副本作为第二份事实来源。

### 关系与权限

- 各用户私有表查询必须带 owner 条件；跨表关联同时验证所属用户，防止关联其他用户的 SSH 连接或分类。
- 当前共享图标、系统任务保持既有访问语义，不凭空创建用户表或把旧共享记录分配给任意用户。
- SSH 文件夹不可形成循环；非空文件夹拒绝删除。目录父子关系必须属于同一用户、同一分类范围。
- 删除被网络唤醒绑定的 SSH 连接时，事务内解除绑定，使设备回到仅支持唤醒的状态；设备电源操作重新校验绑定和认证信息。
- 删除任务继续删除该任务的执行记录；运行中的任务禁止删除。该关系可使用 ON DELETE CASCADE，不向其他业务数据扩展级联。
- 删除扫描、改名历史仅删除对应数据库结果明细，不删除 NAS 实际文件。重复文件移动或删除继续走现有显式确认流程。
- 迁移前检查悬空引用；发现不能无损处理的异常数据时终止迁移并给出记录 ID，不静默丢弃。

### 查询与事务

- Repository 提供按 ID/所属用户读写、筛选、计数、排序和分页，替代整表快照写回。
- 历史和扫描明细采用服务端分页；排序字段使用枚举白名单，值使用绑定参数。
- 索引依据实际查询建立，例如 task_runs(task_id, started_at, id)、scans(owner_uid, created_at, id)、scan_entries(scan_id, size, id)。通过 EXPLAIN QUERY PLAN 验证代表性查询。
- 新增记录与关联更新在同一事务提交。数据库写失败时，不先修改内存状态并返回成功。
- 长时间扫描、哈希、SSH、文件操作在事务之外执行；事务仅保存短时间的数据变更。
- 单个应用实例通过 Nest 管理数据库生命周期，停止任务及后台工作后再关闭连接。大型结果按批写入，避免同步长事务阻塞 SSH/WebSocket。
- WAL 与 FULL 同步保留；检查锁等待、事务失败及磁盘空间不足的错误处理。

SSH 凭据策略补充：按用户明确要求，v2 保存明文认证结构并由当前账号接口返回；旧密文仅在独立升级工具内解密，运行时不再使用密钥。

## NestJS 和 TypeScript

- Controller 处理 HTTP 参数和响应，Service 负责业务和权限，Repository 负责 SQL。
- 引入具体 DTO 和 Nest ValidationPipe，拒绝未知字段，限定字符串长度、数组数量、端口、时间与分页范围。避免把字符串 `"false"` 自动转换成 true。
- 认证、Origin、CSRF 继续在有副作用操作之前执行；上传流单独处理，不通过 JSON DTO 强制缓存。
- 明确区分 400 参数错误、403 权限、404 不存在、409 状态冲突与 500 内部错误。未知异常返回通用信息，服务端日志隐藏密码、私钥和授权令牌。
- 为记录、任务状态、调度规则、扫描结果和 SSH 消息定义类型；外部未验证输入用 unknown 并收窄。
- 最终开启 strict，消除隐式 any 和业务模型中的显式 any；第三方未提供类型的边界以小型适配器封装，不能通过全局关闭检查解决。
- 启动配置集中校验；运行资源由 Nest 生命周期创建和销毁，禁止重复启动调度器。

## 升级与验收

1. 在 NAS 当前 SQLite 数据的一致性副本上运行独立 v1 → v2 转换工具，保留原数据库和凭据密钥。
2. 对照转换前后各业务记录数量、ID、重要字段、关联以及 SSH 凭据解密结果，执行 integrity_check 与 foreign_key_check。
3. 正式运行时仅接受目标 schema。升级工具处理旧 payload，迁移成功后新库不含旧 documents/payload 通用存储表；旧文件只存在于回滚备份。
4. 验证空库初始化、升级失败回滚、重复运行升级、拒绝更新版本的数据库、进程重启恢复。
5. 验证 DTO 错误、跨用户访问、外键与唯一性冲突、任务状态提交、扫描分页排序和并发访问。
6. 保留现有功能回归测试，增加有实际失效风险的数据库和 API 测试；构建 FPK 后再在 NAS 副本上验证。
7. NAS 更新先停应用并备份实际运行目录内容和数据，替换运行代码及目标数据库后启动验收。禁止使用已知会卸载数据的 install-local 升级路径。
8. 验证失败恢复代码、数据库和密钥的同一版本备份。正式验证不执行重启 NAS、关机设备或删除用户文件。

## 官方依据

- [Nest 数据库集成](https://docs.nestjs.com/techniques/database)：驱动可通过 provider 提供给应用，ORM 是选择而非要求。
- [Nest 请求校验](https://docs.nestjs.com/application/validation)：DTO、ValidationPipe、字段白名单及参数校验。
- [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html)：严格类型检查选项集合。
- [SQLite 建表约束](https://www.sqlite.org/lang_createtable.html)：主键、非空、唯一性和 CHECK。
- [SQLite STRICT](https://www.sqlite.org/stricttables.html)：严格类型表及支持类型。
- [SQLite 外键](https://www.sqlite.org/foreignkeys.html)：关系约束、连接级开启与索引。
- [SQLite 查询规划](https://sqlite.org/queryplanner.html)：索引与查询、排序的匹配。
- [SQLite 一致性备份](https://sqlite.org/backup.html)：运行数据库的备份机制。

以上是结合官方能力和本项目运行条件制定的工程方案，不代表官方要求所有项目采用相同表结构。
