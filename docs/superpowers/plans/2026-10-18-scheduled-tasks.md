# NAS 工具箱计划任务实施计划

需求依据：docs/integrations/scheduled-actions.md；用户已确认开始并要求逐项核对官方调用方式，本会话内直接实施。

1. 调度模型与持久化：server/tasks/model.js、store.js、engine.js；测试中国时区跨日/周、单次过期、错过执行不补跑、并发去重、重启中断与输出限制。
2. 任务执行器：server/tasks/runner.js、official.js；显式枚举程序、Docker、脚本、官方重启/回收站/日志命令，未知类型拒绝；支持 dry-run 返回调用计划但不执行。CLI 运行时和授权隔离。
3. API：server/tasks/routes.js，复用管理员及 CSRF 校验；CRUD、立即执行、执行记录、官方能力和授权状态。测试持久化及不支持的能力无法创建。
4. 界面：两个菜单，计划任务列表、任务表单、日志抽屉、官方授权弹窗；保留现有桌面图标数据和功能。
5. 原生包 0.2.0：保留 appname、数据位置与入口 ID；备份当前私有数据及包后部署，执行只读能力核对、无害脚本自动触发/日志与 dry-run 操作。重启、真实清理不作实机破坏性测试。
