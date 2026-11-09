# SQLite 持久化迁移

> 历史 v1 计划，保留用于追溯。通用 payload、启动时导入 JSON、保留密文与内存列表等约定已由用户批准的 v2 改造取代。当前实现以 `docs/sqlite-storage.md`、`docs/backend-architecture.md` 和 `docs/superpowers/specs/2026-10-20-backend-sqlite-hardening-design.md` 为准；本轮 v2 尚未部署 NAS 正式环境。

目标：保留现有接口、权限、SSH 密文与任务调度语义，将本应用管理的 JSON 数据迁移到单一 SQLite 数据库。

- 使用已在 NAS 验证可用的 Node 22 内置 node:sqlite；数据库位于 DATA_DIR/nas-manager.sqlite，权限 0600。
- 按业务建立独立记录表，以记录 ID、账号、顺序和 JSON payload 保存可变业务字段；账号索引为后续数据库查询提供基础。任务与执行记录分别存储，在同一事务提交。
- 首次打开先验证全部旧 JSON；复制旧文件及 SSH 加密密钥到受限权限备份目录；随后在一个事务导入所有数据并提交迁移版本。失败回滚，不覆盖旧文件；迁移成功后只读写 SQLite，旧 JSON 不再参与恢复或覆盖。
- 图标 PNG、SSH 加密密钥、官方 CLI 管理的 session 文件不改格式。
- 保留现有内存缓存与业务 API；本次不宣称分页已经全部改为 SQL 分页。
- 测试：全量导入、一致性、幂等、损坏旧文件阻断、事务回滚、重启持久化、账号隔离、SSH 解密与无明文、原文件不变。
- 发布：先在 NAS 旧数据副本上演练，停服务备份全部数据与旧代码，部署并启动，再核对各表数量和接口；失败恢复旧代码与停机备份。
