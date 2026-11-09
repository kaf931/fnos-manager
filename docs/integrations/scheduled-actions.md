# 计划任务调用方式核对（2026-10-18）

原生包名 deskicons 与数据路径保持不变，显示名改为 NAS 工具箱，提供桌面图标、计划任务两个菜单。

| 用户需求 | 已确认入口 | 接入范围 |
| --- | --- | --- |
| 程序启动/停止 | 官方 appcenter-cli start / stop appname | 已安装原生应用；禁止停止本工具箱及 Node.js 运行时 |
| Docker 程序控制 | Docker Engine Unix Socket 对应 start/stop/restart | 选择设备上的真实容器，禁止任意命令拼接 |
| NAS 重启 | fnos-cli 0.5.0 power reboot --yes，端点 power.reboot | 独立 OAuth 授权后可用；测试不执行真实重启 |
| 回收站 | fnos-cli file trash clear --yes，端点 file.trash.clear | 仅当前授权账号回收站；没有按年龄筛选，不伪装成全局保留策略 |
| 历史日志 | fnos-cli logger clear --level N --module N --yes | 按日志模块/级别清理；没有按日期删除参数 |
| 通用缓存清理 | 未找到通用公开入口 | 不直接删除系统缓存或 SSD 缓存；类型不可创建 |
| 飞牛备份与创建快照 | 未在已审阅开发者 API 与 CLI 参考中找到公开入口 | 保留待核对状态，不宣称已经实现；不使用存储池创建/删除命令冒充快照 |
| 自定义脚本 | /bin/bash，脚本通过 stdin 输入 | 用户明确配置的脚本；以本应用 root 身份执行，限制执行时长与输出量 |

依据：
- https://developer.fnnas.com/docs/cli/appcentercli
- https://help.fnnas.com/articles/v1/settings/authorize
- https://github.com/fnnas-labs/fnos-cli-skill （CLI 及 Skill 许可主体为广州铁刃智造技术有限公司）
- 仓库 reference/power.md、file.md、log.md、oauth.md、stor.md 与 CLI 0.5.0 原生 --help。

官网旧 zip 链接实际返回 403；通过公开 GitHub 0.5.0 发布物获取运行时，验证官方 runtime-manifest.json 中的 SHA256 后使用。完整 API 是官方 CLI 的 OAuth 授权面，并非第三方应用声明 api-scope 后直接拥有同样权限。

计划：每天/每周/间隔分钟/单次（Asia/Shanghai），默认停用，显示下次执行时间；创建、编辑、暂停、立即执行、删除、日志。服务重启跳过已错过的时刻，执行中的任务标记为中断，不自动补跑。单任务禁止重入；同一时刻最多两个任务执行；记录有容量限制。重启、清空回收站和日志清理需在创建时确认影响范围，立即执行还需再次确认。

OAuth 配置隔离于本应用私有数据目录。默认平台安全存储，若不可用仅在用户显式选择本地文件存储时启用 0700 目录下受限文件；一次性 code 和 token 不写应用日志、不回显。不自动代替用户进行 OAuth 授权。
