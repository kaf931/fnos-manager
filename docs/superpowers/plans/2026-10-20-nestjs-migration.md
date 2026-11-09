# NestJS / TypeScript / Express / SQLite 迁移

> 历史计划，保留执行背景。当前实现说明见 `docs/backend-architecture.md` 与 `docs/sqlite-storage.md`。后续范围更新：数据库格式保持不变的约定已被用户批准的完整关系结构改造取代。后续执行以 `2026-10-20-backend-sqlite-hardening.md` 及对应设计为准。

目标：现有前端、URL、请求响应、账号隔离、SQLite 格式均兼容。框架负责路由和依赖管理；经验证的业务模型继续复用，不重写 SSH 协议与数据库。

1. 增加 NestJS Express 运行时与 TypeScript 构建；backend/index.ts 返回原生 Nest 应用；移除 createApp 兼容包装，测试直接使用 Nest API。
2. backend/app 下按图标、任务、终端、存储、网络唤醒建立标准 Nest Module / Controller / Provider。将原 Express 路由迁移到显式 Nest 控制器，移除重复注册源。
3. 统一飞牛管理员、Origin、CSRF 校验及错误响应；保留二进制上传和下载流、8MiB JSON 限额。
4. 异步服务工厂声明终端→网络唤醒→任务依赖，Nest 生命周期关闭调度、文件工作进程和 SSH。WebSocket 保留原 ws 协议，不切换 Socket.IO。
5. 验证完整旧测试、Nest DI/路由元数据、JSON/二进制边界、错误与生命周期。FPK 包含编译产物及生产依赖。
6. NAS 数据副本演练成功后备份数据与真实代码内容，使用可恢复的运行目录更新验证，禁止 install-local 升级既有应用。保留原数据，不使用卸载式更新。

用户随后明确要求完整迁移：全部 Node 后端源代码位于 backend/，使用 TypeScript；server/ 只保存可删除重建的编译输出。旧 Express 路由、旧 createApp/.locals 包装与双轨启动全部删除。独立的 Python 文件操作工具仍作为功能实现调用，不提供旧 HTTP 后端。SQLite 数据库格式不变。
