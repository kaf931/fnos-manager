# 安装、更新与卸载数据处理

2026-10-22，0.2.52 同版本补全。使用官方生命周期脚本及 JSON 用户向导。

## 用户行为

- 更新默认保留配置和数据库，不提供清空选项。
- 在飞牛应用中心卸载时，先显示系统确认，再进入“应用数据”向导。默认“保留数据，重新安装后继续使用”；可改选“删除全部应用数据”。
- 保留范围包括图标配置、任务和日志、SSH 连接/凭据、AI 配置/聊天、存储记录、网络设备和偏好。保留的数据仍包含原先保存的凭据。
- 明确删除只清理本应用三个数据目录的内容，不删除用户扫描目录、远程文件、Docker 容器或其他应用。已经安装的独立桌面入口需要另行管理。
- 同一存储空间重新安装时自动沿用保留数据；不自动跨存储空间查找或合并历史数据。

## 实现

`wizard/uninstall` 来自 `scripts/wizard/uninstall`，radio 字段 `wizard_data_action` 取 `keep` / `delete`，默认 `keep`。未传入字段同样保留；非法值报错，不执行删除。

`scripts/lifecycle-hooks.js` 生成包内脚本：

| 脚本             | 操作                                            |
| ---------------- | ----------------------------------------------- |
| install_callback | 检查已有 SQLite，初始化或执行已支持的数据库迁移 |
| upgrade_init     | 停止服务，检查数据库完整性和外键                |
| upgrade_callback | 使用现有 DatabaseService 迁移并再次检查         |
| uninstall_init   | 停止服务，验证数据目录，根据选项保留或清理      |
| 其余回调         | 无额外数据处理                                  |

数据处理实现为 `backend/lifecycle.ts`，编译到 `server/lifecycle.js`，由声明依赖的 Node.js v22 运行。复用现有 SQLite schema/迁移，不再维护另一套数据库初始化 SQL。

处理前一次性验证 `TRIM_APPNAME`、`TRIM_PKGVAR`、`TRIM_PKGETC`、`TRIM_PKGHOME`：必须对应同一 `vol数字` 空间中该应用的 `@appdata`、`@appconf`、`@apphome` 目录，拒绝目录重定向和符号链接。删除只清理这些目录的直接子项；递归删除符号链接本身，不跟随链接。数据库需为真实普通文件。损坏数据库不会被空库覆盖，失败写入 `TRIM_TEMP_LOGFILE` 并返回非零。

停止服务失败时，`set -eu` 阻止后续数据处理。卸载数据在 init 阶段处理，避免 callback 阶段运行文件已被移除。

## 验证与边界

本地新增9项测试：默认保留、明确清理、非法选项/路径、目录及数据库链接拒绝、已有数据保留、坏库不覆盖、schema7→8保留图标迁移、停止失败中止、其他应用及外部链接目录不受影响。全量398项测试通过，strict、AST审计、lint、格式及FPK构建通过。代码复核未发现阻塞问题。

在 NAS 的隔离应用 `kaf.lifecycle.probe052` 中验证：

1. 无自定义清理脚本卸载后，三个系统数据目录仍保留。
2. 应用中心确实显示两种选项并默认选中保留，截图 `docs/screenshots/uninstall-data-wizard-v052.png`。
3. 网页选择保留后完成卸载，再通过FPK重新安装，SQLite测试记录保持且完整性正常。
4. 通过隔离应用的实际升级及卸载脚本验证，明确 `delete` 后三个目录内容为空。该项通过脚本验证，未在网页点击永久删除选项。
5. 带卸载向导时，当前NAS的 `appcenter-cli uninstall` 拒绝直接卸载并要求使用Web UI。CLI可能返回0但输出错误，必须检查真实状态，不能仅凭退出码认定成功。

上述卸载/删除只用于隔离应用，未卸载或清空 NAS 管家。应用中心的完整原位更新流程未在主应用上执行，升级验证涵盖真实生命周期脚本和SQLite迁移。版本维持0.2.52，不能将同版本安装包被拒绝当作升级成功。

## 官方依据

- [应用框架与生命周期](https://developer.fnnas.com/docs/core-concepts/framework)
- [用户向导](https://developer.fnnas.com/docs/core-concepts/wizard)
- [应用CLI](https://developer.fnnas.com/docs/cli/appcentercli)

官方内容通过 `https://developer.fnnas.com/llms-full.txt` 核对。宿主目录保留行为和CLI限制来自当前NAS实测，不声称覆盖所有fnOS版本。
