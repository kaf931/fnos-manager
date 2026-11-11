# NAS 管家：官方开放能力边界与最小权限整改说明

核对日期：2026-11-11  
代码基线：`021fa38`，运行版本 `0.4.2`  
文档状态：调研与整改设计，**尚未实施运行身份切换**。

## 1. 结论

飞牛应用开放平台已经提供了让 NAS 管家以普通应用账号运行所需的基础机制：包用户、统一网关、文件和目录授权、按当前用户检查文件权限、应用设置入口，以及安装和升级生命周期。

这些机制足以覆盖通知、提醒、应用自身的数据管理、远程连接代理，以及经过目录授权的扫描和文件操作。SSH、VNC、RDP、网络 ADB 的目标设备权限由各自的账号或配对授权决定，无需让 NAS 上的主服务成为 root。

**官方开放平台当前公开的 API 不能等同于通用系统管理授权，更不是通用 sudo 接口。** 官方《概述》将当前开放范围定位为文件授权、页面路由、界面状态和后端查询等基础能力。Docker 控制、系统应用安装、任意脚本执行、USB 设备权限和运行文件替换，需要另外核对具体实现与授权通道，不能承诺“弹窗确认后全部自动可用”。[官方 API 概述](https://developer.fnnas.com/api/overview)

针对“长驻服务以 root 运行，并暴露系统管理/远程终端风险面”的审核意见，建议采用：

> 主服务和普通子进程以专用应用账号运行；用户文件访问走官方目录授权与用户 ACL 检查；确有已验证授权通道的系统操作由系统检查权限后执行；其余操作明确限制或交给用户手动完成。

降权解决的是操作系统权限问题。高风险功能是否默认开放、凭据保护、用户隔离、命令执行边界仍需单独整改。完成这些措施也不能保证审核一定通过。

## 2. 三种“授权”必须区分

| 类型 | 授权后获得什么 | 不能据此认为 |
| --- | --- | --- |
| 应用包用户与文件 ACL | 普通应用用户能够访问指定目录或文件 | 主服务已经获得 root，或能够读取所有存储卷 |
| 应用开放 API Scope 与应用 token | 当前应用可以调用声明并获准的开放 API | token 是管理员登录凭据，或任意系统命令均可执行 |
| AI Agent / fnos-cli 的 OAuth 连接 | 经用户确认的 CLI 会话可以调用其获准的系统能力 | 开放平台所有应用天然具备这些能力，或所有系统版本与模块都支持 |

此外，SSH 的账号密码或密钥、RDP/VNC 的登录信息、ADB 配对都是**目标设备的访问凭据**，与本应用在 NAS 上的 Linux 运行身份不同。

此前“通过授权接口重启 NAS”的说明属于可采用的架构方向，不能据此推断应用开放平台已有一个通用重启 API。应分别确认该操作是否有公开接口、CLI 是否支持、实际账号是否获准、目标系统是否实现，再决定是否接入。

## 3. 官方文档直接支持到哪一步

### 3.1 使用专用应用账号运行：直接支持

`config/privilege` 可以声明：

```json
{
  "defaults": {
    "run-as": "package"
  },
  "username": "deskicons",
  "groupname": "deskicons"
}
```

这表示以应用账号运行，不是以当前登录飞牛的管理员账号运行。运行账号与管理员登录身份是两层不同的控制。

官方允许按实际资源需要加入附加用户组，但每增加一个组都会扩大权限。因此不能以“加入 Docker 用户组”作为通用降权方案。是否需要设备组，应逐项说明用途并在设备上验证。

官方也说明：生命周期确有特权准备工作时可以使用 root，并在启动对外服务前降权。这是受限准备流程，不是常驻 root Web 服务的理由；是否允许本应用保留这种生命周期设计，还需要与审核要求核对。[官方应用权限](https://developer.fnnas.com/docs/core-concepts/privilege)

### 3.2 统一网关、登录身份与 WebSocket：直接支持

官方统一网关先检查飞牛登录态，再转发到应用的 Unix Socket。网关提供 `X-Trim-Userid`、`X-Trim-Isadmin` 等身份上下文，支持 HTTP 与 WebSocket。

应用仍负责：管理员限制、记录归属、文件路径校验、终端会话归属与高风险操作权限。不能仅凭前端隐藏按钮认定接口安全，也不能把另一个可直连的 HTTP 端口收到的同名 Header 当作可信系统身份。

`gatewaySocket` 按官方约定位于应用 `target` 目录。普通应用用户必须能够在正确位置创建 Socket，且 Socket 权限不能为了方便放宽为所有用户可写。[官方统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration)

### 3.3 用户目录授权与授权查询：直接支持

| 场景 | 官方能力 | NAS 管家的适用位置 |
| --- | --- | --- |
| 当前用户选择并授权自己的文件或目录 | `pickUserFile`、`authorizeUserFile` | 空间分析、重复文件、文件整理等目录入口 |
| 管理员配置应用共享目录 | `pickSharedFile`、`authorizeSharedFile` | 确实需要共享固定目录的后台任务 |
| 重启或刷新后恢复授权目录列表 | `trim.file.getUserAccessibleFolders`、`trim.file.getSharedAccessibleFolders` | 后端授权范围同步、目录选择列表 |
| 用户撤销已有目录授权 | 对应的删除授权路径 API | 授权管理与后续访问撤销 |

共享授权只支持目录，个人授权支持文件和目录；应用共享授权需要管理员操作。不能用普通的文件选择结果替代已授权结果，也不能把前端上报的任意路径当作已授权路径。[个人授权](https://developer.fnnas.com/api/authorization/user-access)、[共享授权](https://developer.fnnas.com/api/authorization/shared-access)

### 3.4 区分应用权限和当前用户权限：直接支持，后端必须接入

应用账号获得某目录 ACL 后，代表应用进程有机会访问它；不代表每一个使用应用的人都可以访问该目录。

官方 `trim.file.checkUserACL` 接受当前用户 UID 与一个或多个路径，返回可读、可写、可删除的结果。NAS 管家应按操作分别检查；目录可读也不能直接推导出所有子文件均可读。扫描、预览、下载、改名和删除需要在真正的执行边界检查权限。

当前用户 UID 来自可信网关。路径检查还需保留现有的规范化、符号链接与挂载边界保护。撤销授权后，后续操作应拒绝继续执行；长任务不能只在创建时检查一次，之后一直信任旧状态。[官方文件权限检查](https://developer.fnnas.com/api/authorization/file-acl)

### 3.5 打开授权与设置界面：直接支持，但不是提权接口

SDK 的 `openAppSetting()` 可以引导用户进入应用设置。文件授权接口可以打开相应系统选择或授权流程。独立浏览器场景可按文档使用 App Auth 路由；飞牛 App 宿主内应采用对应 SDK 能力，不能假定 Web 路由授权在移动宿主同样可用。

这些操作负责展示界面或申请特定文件访问，不负责执行任意 root 命令。打开设置页成功，也不等于用户已完成授权。[官方调用方式](https://developer.fnnas.com/api/calling)、[页面路由](https://developer.fnnas.com/api/page/routing)

### 3.6 应用 token 与 API Scope：直接支持

官方后端 API 经 `/var/run/trim_open_gateway_apiscope.socket` 访问 `POST /api/v1/trimapp`。系统通过应用脚本环境中的 `TRIM_API_TOKEN` 提供应用调用身份。

本项目可以按实际调用声明以下 Scope：

```json
{
  "api-scope": [
    "trim.file.userAccess",
    "trim.file.userAcl"
  ]
}
```

如果最终提供共享目录管理，再增加 `trim.file.sharedAccess`；后端确需系统版本信息时，再增加 `trim.system.getPlatformConfig`。不要为了未来可能使用而一次声明所有 Scope。

安全要求：token 仅供应用后端使用，不返回前端、不写日志、不持久化；进程使用启动环境提供的 token，重新注册或重启后读取新的环境值。不能把 token 交给自定义脚本或不可信扩展；仅删除环境变量也不足以把同 UID 的恶意脚本与主服务完全隔离。[官方调用方式](https://developer.fnnas.com/api/calling)

### 3.7 安装、升级与数据迁移：支持生命周期，不等于运行时提权授权

官方提供安装、升级、卸载流程及生命周期脚本，可以安排配置迁移、数据迁移与兼容检查。公开的 `appcenter-cli` 文档列出了安装和启停命令，但命令出现在开发文档中，不等于普通包用户天然可以执行全部操作。

同样，文档没有保证应用可以任意改写自己的运行文件、以其他身份重启服务，或安装任意其他应用。应用内更新是否继续支持，要验证完整的非 root 流程及审核允许的分发方式。[官方应用框架](https://developer.fnnas.com/docs/core-concepts/framework)、[appcenter-cli](https://developer.fnnas.com/docs/cli/appcentercli)

## 4. 版本与运行环境边界

官方本次核对的接口表，对个人授权、共享授权、文件 ACL 检查等能力列出的系统要求为 **1.2.0401**，App 版本要求为 **1.34.0**。具体以各接口页为准，不能据此推导所有 Agent 授权或系统管理能力都具备同一版本门槛。[个人授权接口表](https://developer.fnnas.com/api/authorization/user-access)、[文件 ACL 接口表](https://developer.fnnas.com/api/authorization/file-acl)

因此：

- 不能再笼统认为“ARM 1.2.0701 必然没有文件授权能力”。
- 也不能因为版本号达到要求，就声明 ARM 真机、移动宿主和全部管理接口均已验证。
- 应检测 SDK、后端开放 API、Scope/token 及目标功能是否实际可用。
- 不支持时明确解释原因，不能偷偷退回 root 或绕过鉴权。
- 前端 SDK 需要 `micro_app=true`，当前安装包已声明；仍需验证宿主初始化和授权取消场景。

## 5. 当前项目与官方建议的差距

以下结论来自当前代码和已授权 NAS 的只读检查，不是对所有安装设备的推断。

| 位置 | 当前实现 | 差距或风险 |
| --- | --- | --- |
| `scripts/package.js` | 生成 `run-as: root`，`config/resource` 为 `{}` | 没有采用包用户作为默认常驻身份，也未声明文件授权/ACL 所需 Scope |
| `scripts/service-main.sh` | 直接启动 `node server/index.js`，没有身份切换 | 已安装 NAS 的主服务实际是 root；并非只是包内声明不准确 |
| `backend/index.ts` | 生产使用 `app.sock`，非 Socket 模式仅监听回环 | 方向正确；还需确保正式包不能意外进入开发鉴权模式 |
| `backend/app/common/security.ts` | 管理员 Header、写请求 token 等检查 | 应保留；这些检查不能替代操作系统降权和文件访问权限 |
| `backend/storage/service.ts`、`access.ts` | 有目录范围、路径和扫描边界保护 | 目前未接入官方个人/共享授权查询及 `checkUserACL`；不能把 `/vol*` 当作用户授权范围 |
| `backend/tasks/runner.ts` | 自定义脚本继承服务身份与环境；应用、Docker 使用本地系统命令 | 当前会继承 root；降权后也需避免脚本接触应用凭据和同 UID 私密数据 |
| `backend/docker.ts` | 直接访问 `/var/run/docker.sock` | 普通包用户通常无权访问；不能通过加入高权限 Docker 组掩盖风险 |
| `backend/native.ts`、`app/icons/icons.service.ts` | 直接调用 `appcenter-cli` 安装、更新、卸载生成的桌面入口 | 需要验证可用的受控安装途径；无法确认时保留下载 FPK、手动安装的路径 |
| `backend/tasks/official.ts` | 已有独立的 fnos-cli OAuth 流程 | 可作为候选系统管理通道，但不是开放平台的应用 token，必须分别验证权限与版本 |
| `backend/terminal/transport.ts`、`session.ts` | 网关用户归属、会话票据；SSH 连接目标账号 | 可在非 root 进程中保留；高权限目标账号仍是高风险凭据 |
| `backend/updates/manager.ts`、`install.ts` | 直接备份并替换运行文件，调用生命周期脚本重启 | `supported()` 目前未完整验证非 root 写入与服务控制权限；降权迁移时需避免下载完成后才报错 |

实机还确认：已有 `deskicons` 应用账号，但当前服务 UID 为 0；数据目录由 root 持有且为受限访问。**不能只改启动 UID，否则应用可能无法打开现有数据库。** 需要在降权之前完成仅针对本应用目录的数据属主迁移，并保护安装目录、Socket 和生命周期脚本的权限边界。

## 6. 各功能建议如何保留

| 功能 | 普通应用账号运行方案 | 官方开放平台支持程度 |
| --- | --- | --- |
| 设置、通知、提醒、应用内消息 | 只访问本应用数据库和数据目录 | 包用户机制即可，无需申请系统提权 |
| AI 聊天、附件、Skills 文件存储 | 使用应用数据目录，外部网络按功能访问 | 无需 root；模型密钥与授权凭据仍须保护 |
| SSH / VNC / RDP | 主服务负责协议代理，目标设备账号负责认证 | 网关与用户上下文可复用；协议实现由本项目负责 |
| SSH 中 AI 执行命令 | 在绑定的 SSH 会话上按目标账号权限执行，保留审查 | 不是主服务 root；高权限远端账号仍需用户明确配置 |
| 网络 ADB / 投屏 | 使用 ADB 连接或配对及应用自己的密钥目录 | 不依赖 root；配对不是飞牛文件授权 |
| USB ADB | 按具体 USB 设备授权，验证发现、连接和撤销 | 当前文档未给出通用 USB 动态授权接口，需单独验证设备规则和审核要求 |
| 空间分析、重复文件、文件整理 | 授权目录查询 + 当前用户 ACL + 实际文件操作 | 主要能力可由公开文件授权机制覆盖 |
| 网络唤醒 | 普通 UDP 操作；特殊网络环境单独验证 | 不需要通用 root；远程设备重启另按 SSH 凭据处理 |
| 程序启停、Docker 任务 | 候选为已验证的 fnos-cli OAuth 管理命令 | 不是目前应用开放 API 清单直接承诺的通用能力 |
| 桌面图标生成 | 普通账号生成 FPK | 无需 root |
| 桌面图标自动安装/卸载 | 验证独立授权的应用管理通道；不可用时下载 FPK 手动处理 | 自动安装的非 root 路径尚需真机验证 |
| 本机自定义脚本 | 默认禁用任意本机执行，或另设计真正隔离的执行环境；可讨论以明确的 SSH 资产替代 | 没有“用户点确认即成为安全 root 脚本”的官方能力 |
| GitHub 更新检查与下载 | 普通账号联网、写更新缓存 | 无需 root |
| GitHub 安装、回滚和重启 | 单独验证非 root 文件权限、控制脚本与发布政策；无法满足时提供手动安装 | 不能仅因开放平台有生命周期脚本就宣称支持安全自更新 |

这里“默认禁用本机任意脚本”属于建议的产品取舍，尚未执行。若需要保留，必须在实施前明确隔离方案；普通 UID、清理环境变量和用户勾选确认都不构成完整沙箱。

## 7. AI Agent / fnos-cli 能补到哪一步

飞牛官方帮助中心提供 AI Agent 授权入口说明；本项目已经实现 fnos-cli 的生成授权链接、兑换授权码、只读验证与断开授权。[官方 Agent 授权说明](https://help.fnnas.com/articles/v1/settings/authorize)

本次在 NAS 对随应用打包的 CLI 做了**只读帮助检查**：版本为 `0.5.0`，帮助中包含应用列表、启停、安装 FPK，以及 Docker 容器列表等命令。该结果只证明命令入口存在，**未执行安装、容器控制、重新授权或提权操作，也未证明各写命令已经获准使用**。

可以据此安排后续验证，但不能把候选方案写成已实现：

1. 核对 OAuth 实际申请的权限范围，不能宣传“单功能授权”却申请一组广泛管理权限。
2. 按具体命令确认当前系统、授权账号和所需模块支持情况；读接口先验证，写接口使用隔离测试对象。
3. 区分服务账号无权限、OAuth 过期、OAuth 范围不足、接口未提供与目标对象不存在。
4. 授权取消或撤销后立即停止后续操作，不自动重试写命令、不自动切回本地 root。
5. 本项目当前计划任务官方连接按应用保存；继续管理员共享时应说明共享边界。若将来支持普通用户，必须按 UID 隔离凭据和任务。

**开放平台应用 token 与 CLI OAuth token 不通用。** `trim.file.userAcl` 也不是 Docker 或应用管理权限，不能混用名称或“去授权”入口。

## 8. 用户看到的授权流程

弹窗应描述具体操作与所需权限，不使用含义不清的“授予 root 权限”。复用现有公共弹窗、按钮和授权组件。

| 原因 | 建议提示 | 后续动作 |
| --- | --- | --- |
| 目标目录未授权 | “需要访问此目录，请先选择并授权目录。” | 打开相应 SDK 授权流程，完成后重新检查 |
| 当前飞牛用户无权写入 | “当前账号没有此目录的写入权限。” | 引导联系管理员或选择其他目录，不能仅重开应用授权 |
| 包缺少 API Scope 或应用 token 失效 | “应用授权配置不可用，请检查安装或重新启动应用。” | 记录安全诊断；不能引导用户反复输入 OAuth 授权码 |
| 系统管理 OAuth 未连接 | “此操作需要飞牛官方授权。” | 打开已有官方连接流程；完成后由用户重新发起原操作 |
| 目标 SSH 账号权限不足 | “目标账号没有执行此操作的权限。” | 修改目标账号配置或由用户在目标设备处理 |
| 当前平台没有该授权能力 | “当前系统暂不支持此操作，请手动完成。” | 提供可用的手动入口，不伪装授权成功 |

授权完成后需要重新校验实际权限。尤其是删除、安装、重启等写操作，不因用户刚完成授权就直接自动重放。

## 9. 推荐实施顺序

### 第一阶段：移除常驻 root，保证数据和启动可靠

- 将新包默认身份改为 package，并核对生命周期、数据目录、Socket 的权限。
- 现有 root 安装升级前备份数据库和运行文件，仅迁移本应用数据；不递归修改用户存储卷，不使用 `chmod 777`。
- 生产服务启动时验证实际 UID，防止因配置失效继续以 root 提供访问。
- 保留统一网关管理员入口与会话检查，核对所有子进程身份。
- 数据属主迁移在新 UID 首次读数据库之前完成。迁移机制必须能在真实升级流程运行，不能只依赖开发机 SSH 手动修好。

### 第二阶段：接入完整的文件授权边界

- 按实际功能声明 Scope，前端用官方选择/授权入口。
- 后端基于授权列表确定可访问范围，叠加当前用户 ACL 和现有路径防护。
- 分别保护读、写、删除，覆盖下载、批量操作与后台扫描。
- 授权撤销、接口不可用、未知返回值按拒绝访问处理，不降级成扫描所有卷。

### 第三阶段：逐项改造高权限功能

- 程序和 Docker 管理验证 OAuth 候选通道，移除对应直接高权限本地调用。
- 桌面入口生成与安装解耦，保留安全的生成/下载能力。
- 本机任意脚本与 USB ADB 分别完成隔离/设备授权设计，避免把广泛权限重新加回主服务。
- 自更新先验证普通账号完整流程；权限不足时在开始前提示手动更新，不进行半截安装。
- 增加统一结构化错误与公共授权提示，不能只替换错误文字。

### 第四阶段：准备审核证据

- 展示实际常驻进程及子进程均为非 root，而不只是展示 privilege 文件。
- 验证未登录、非管理员、其他会话票据、未授权路径和伪造 UID 请求被拒绝。
- 验证服务无 Docker 高权限组、无无限制 sudo、无任意 root 执行服务。
- 分别在干净安装及保留数据升级场景验收；现有测试 NAS 未经应用中心真正升级，不能代替安装器验证。
- 完成 x86_64 / ARM64 与手机宿主测试，记录尚未覆盖的设备和能力。

## 10. 验收清单

- [ ] 安装包使用 package；常驻进程与子进程实际 UID 非 0。
- [ ] 服务无法写系统敏感目录、读取其他应用私密文件或直接操作 Docker Socket。
- [ ] 仅通过受控网关提供生产入口，管理员限制、会话归属和来源校验继续有效。
- [ ] SDK 取消授权、应用 Scope 不足、token 失效与旧版本不支持有准确提示。
- [ ] 文件读取同时满足应用授权范围和当前用户 ACL；批量删除也逐项检查。
- [ ] 授权撤销后新操作及长任务后续执行正确停止。
- [ ] 任意脚本不能通过继承环境、同 UID 文件或可修改的特权脚本获取主服务凭据/系统权限。
- [ ] SSH / VNC / RDP / ADB 继续按各自目标凭据工作，不需要恢复主服务 root。
- [ ] 安装、自更新、失败回滚及后台任务在非 root 身份下完整验证。
- [ ] 原数据库和附件保留，完整性检查与外键检查正常。
- [ ] 应用中心登记版本、真实运行版本、包权限声明与实际进程身份分别记录。

## 11. 来源与核对范围

官方开发文档正文以官网当日提供的 [完整文档](https://developer.fnnas.com/llms-full.txt) 核对，页面入口如下。部分页面在网页抓取工具中不可读取，已直接通过 HTTPS 获取官网正文，未将社区镜像作为官方能力依据。

- [应用权限](https://developer.fnnas.com/docs/core-concepts/privilege)
- [应用资源](https://developer.fnnas.com/docs/core-concepts/resource)
- [环境变量](https://developer.fnnas.com/docs/core-concepts/environment-variables)
- [统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration)
- [应用框架](https://developer.fnnas.com/docs/core-concepts/framework)
- [Manifest](https://developer.fnnas.com/docs/core-concepts/manifest)
- [开放 API 概述](https://developer.fnnas.com/api/overview)
- [调用方式与认证](https://developer.fnnas.com/api/calling)
- [个人授权路径](https://developer.fnnas.com/api/authorization/user-access)
- [共享授权路径](https://developer.fnnas.com/api/authorization/shared-access)
- [文件 ACL 检查](https://developer.fnnas.com/api/authorization/file-acl)
- [平台配置](https://developer.fnnas.com/api/platform-config)
- [页面路由](https://developer.fnnas.com/api/page/routing)
- [错误码](https://developer.fnnas.com/api/error-codes)
- [appcenter-cli](https://developer.fnnas.com/docs/cli/appcentercli)
- [官方 Agent 授权说明](https://help.fnnas.com/articles/v1/settings/authorize)

本次只完成官方能力核对、代码审阅及 NAS 的只读进程/文件权限/CLI 帮助检查，未切换服务用户、修改 Scope、安装新包或执行高权限管理命令。
