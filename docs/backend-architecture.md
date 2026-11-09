# NAS 管家后端架构

当前后端使用 NestJS 12、TypeScript 5.9、Express 5 adapter 和 Node 内置 SQLite。`backend/` 是唯一 Node 后端源代码目录，`server/` 是可删除重建的编译产物。前端五个菜单及既有 API 前缀 `/app/deskicons` 保留。当前正式版本为 0.2.13 / schema v4，已按保留现有数据的增量方式更新到 NAS。

## 目录与职责

| 路径 | 职责 |
| --- | --- |
| `backend/index.ts` | 进程入口、环境与默认选项、监听 TCP/Unix socket、信号关闭 |
| `backend/app/bootstrap.ts` | 创建 Nest Express 应用，安装认证、JSON 解析、Guard、ValidationPipe、异常过滤器和静态资源 |
| `backend/app/app.module.ts` | 汇集 common、icons、terminal、storage、wake、tasks 模块 |
| `backend/app/common/` | 共享选项、账号和 CSRF/Origin 检查、错误映射、数据库 provider、资源生命周期 |
| `backend/app/{icons,terminal,storage,wake,tasks}/` | 模块、Controller、DTO 和 Nest Service；HTTP 参数、权限和业务协调 |
| `backend/domain/` | 图标、Docker、SSH、唤醒、任务、存储等业务契约 |
| `backend/persistence/` | 唯一 SQLite 连接服务、v3 DDL、SQL 辅助及按业务 Repository |
| `backend/terminal/` | SSH/本地终端、WebSocket、主机密钥、分类与指令、文件操作和监控 |
| `backend/tasks/` | 调度模型、任务执行引擎、进程执行、设备任务和官方 OAuth CLI 客户端 |
| `backend/storage/` | 存储边界、扫描、重复文件、改名与 worker；Python 工具负责实际文件工作 |
| `backend/wol.ts`、`wake-power.ts` | UDP Magic Packet、设备管理、经确认的 SSH 固定电源命令 |
| `backend/core.ts`、`icons.ts`、`package.ts`、`native.ts`、`docker.ts` | 快捷入口校验、图标渲染、FPK 生成、原生应用中心和 Docker 查询 |
| `backend/upgrade/` | 独立离线 v1 → 当前版本转换及旧凭据解密；不参与日常启动 |
| `scripts/` | 编译、前端/原生打包与离线升级入口 |
| `tests/` | API、权限、持久化、任务、终端和文件行为的 Node 测试 |
| `web/`、`dist/` | 前端源码及 Vite 产物 |

## 调用与数据契约

Controller 声明路由并接收 DTO；Nest Service 处理账号与操作条件，再调用领域服务和 Repository。HTTP 请求使用 ValidationPipe 的 transform、白名单和拒绝未知字段，关闭隐式类型转换；上传和 WebSocket 使用各自的边界校验。浏览器发来的账号字段不能覆盖可信网关身份。

业务模型使用具体字段、状态和结果联合类型。外部 JSON、错误、网络数据等以 `unknown` 接收并验证；Node 和 ssh2 使用真实 API 类型。TypeScript 开启 `strict`，后端 ESLint 将显式 `any` 作为错误，并限制 Controller 直接访问 Repository、Domain 导入应用层或持久化层。启动配置在任何 Provider 打开文件或连接前集中校验。不得以宽泛别名、类型忽略或关闭检查替代业务类型。

Repository 负责 SQL、绑定参数、所属用户条件和分页；不提供通用 JSON 路径存储接口。v3 的列、外键、索引、JSON 例外及凭据策略见 [SQLite 存储](sqlite-storage.md)。数据库事务只接受同步回调，使用短事务和嵌套 savepoint；网络、进程和文件操作在事务外执行。业务写入以数据库提交为准，不能把整份内存列表作为第二份事实来源。

认证、Origin 与 CSRF 在有副作用操作前检查。预期业务错误通过明确状态码返回；未知错误映射为通用 500，不能把内部错误和凭据回传。SSH 密码、私钥及口令按已确认要求明文保存并由当前用户连接接口返回，日志不得打印认证内容。

## 生命周期

CommonModule 创建并注入单个 `DatabaseService`。Resources 登记后台服务，应用完成初始化后按选项启动调度器。关闭顺序为任务引擎、唤醒电源服务、存储 worker、AI 请求与执行通道、终端会话、图标任务、数据库；关闭过程可重复调用。任务和 worker 必须结束后再释放数据库。正常服务接受 v3 或全新空目录；v2 在事务内增量新增 AI 设置表并登记 v3。v1 必须先经过离线升级。

没有旧 Express 路由或旧 JSON 存储并行入口。Python 文件工具由业务服务调用，不提供独立旧 HTTP 后端。

## 开发与发布命令

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | TypeScript 严格检查，不生成文件 |
| `npm run lint` | 检查后端、前端、脚本和测试；生成目录被排除 |
| `npm run format:check` | 检查工程文件格式 |
| `npm run format` | 应用 Prettier 格式 |
| `npm run build:server` | 删除并重建 `server/`，复制 Python 工具 |
| `npm test` | pretest 先重建后端，再执行 `tests/*.test.js` |
| `npm run build` | 重建后端并执行 Vite 前端构建 |
| `npm start` / `npm run dev` | prestart/predev 重建后端后运行同一 Nest 入口 |
| `npm run pack` | 重新构建前后端，按固定运行依赖锁文件安装并创建原生 FPK |
| `node scripts/upgrade-database.js SOURCE DESTINATION` | 使用已编译代码进行独立离线 v1 → 当前版本转换 |

只修改 `backend/`，不要手改 `server/`。编译会清空输出目录；多人或多代理协作时由一个执行者统一构建，其他执行者用 typecheck，避免互相删除产物。发布前检查最终源码、测试与产物来自同一轮构建；不能沿用修改前的 FPK 或旧部署验收结果。

## 离线升级与 NAS 更新

1. 在源码目录编译最终后端，准备独立源库副本，保持旧 `terminal/credential.key` 与源库相邻的原目录关系。
2. 运行升级脚本，目标选择尚不存在的新路径；工具只读源库、制作一致性快照、事务转换并验证完整性和外键后发布新库。它不会覆盖已有目标，不会在正常启动时执行。
3. 核对转换报告、记录 ID、字段、凭据、关联和只读 API，再停止正式服务，完整备份实际代码与 DATA_DIR。
4. 从停机副本生成最终候选库，部署最终代码与对应当前版本数据，保留图标和官方 session，避免旧 WAL/SHM 与新库混用。
5. 启动验收五菜单、账号隔离、任务与扫描分页；失败时恢复同一停机快照。此 NAS 禁止使用已知会卸载数据的 `appcenter-cli install-local` 升级既有应用。

完整操作约束、回退方法与历史证据路径见 [SQLite 存储](sqlite-storage.md)。设计与实施进度分别保存在 `docs/superpowers/specs/2026-10-20-backend-sqlite-hardening-design.md` 和 `docs/superpowers/plans/2026-10-20-backend-sqlite-progress.md`。历史计划用于追溯，不作为当前 schema 和正式部署状态的依据。

扫描与改名历史读取摘要，分页在 SQL 执行；改名明细在查看或撤销时才加载。文件处理与批量删除在队列实际执行时重新检查忙碌状态，整批删除提交成功后更新内存；扫描结果分批落库并发布 generation 后才向客户端显示完成。

发布运行依赖由 `scripts/runtime-package-lock.json` 锁定，打包执行 `npm ci`。依赖变更后显式运行 `npm run lock:runtime` 更新锁文件；版本号由打包流程同步，依赖不一致时拒绝打包。Linux Sharp 补充归档同样核对锁文件的 SHA-512。原生停止脚本等待进程退出后移除 PID，30 秒超时则返回失败并保留 PID，避免清理未完成即启动新进程。

Deployment update (2026-10-20): v2 is deployed on NAS with a fresh database, per user request. Earlier pending-deployment text is historical.


## SSH AI 助手（0.2.12）

`backend/terminal/ai/` 分离兼容模型客户端、设置校验、会话状态机与 SSH exec 执行器；`backend/app/terminal/ai.*` 提供 DTO、所属账号校验和应用层协调。AI 配置按用户持久化，聊天及不可变命令提议仅存在当前 SSH 会话内。API 返回公开设置和 `hasKey`，不返回 API Key。

模型使用 OpenAI 兼容 `/chat/completions` function tools，支持 SSE 和普通 JSON 响应；必须配置支持该协议和工具调用的模型。命令先保存不可变提议；默认审核模式由用户确认 ID 后执行，用户主动选择静默模式后在当前 SSH 会话内顺序自动执行；不接收前端替换后的命令，不自动发送终端缓冲区或 SSH 凭据。独立 exec 通道不继承交互终端的目录和环境。输出返回模型后，后续命令遵循本轮显式权限；新会话默认审核。

执行超时 30 秒、总输出上限 64 KiB、命令上限 16 KiB、单个问题最多 10 轮工具调用、上下文上限 512 KiB。切换或关闭会话取消在途操作并使旧提议失效，前端使用单调递增选择序号隔离晚到请求。所有副作用接口经过现有身份与 CSRF 验证。

模型选择复用公共 NativeSelect，从已配置服务的 `/models` 获取列表，失败保留手动配置值。接口参照 [Models API](https://developers.openai.com/api/reference/resources/models/methods/list)。列表结果仅代表可用模型 ID，不保证每个模型支持工具调用。AI 面板审核队列固定于输入卡片上方，发送/停止使用同一图标按钮；全站滚动条外观集中于 `web/shared-scrollbars.css`。


## 多供应商与持久对话（0.2.13 / v4，尚未发布 NAS）

AI 配置现支持多个 OpenAI、Claude、Ollama 供应商，每个账号最多20个；供应商独立保存协议、地址、Key和默认模型。`native-protocols.ts` 负责 Claude Messages 和 Ollama Chat 的原生消息/工具结果映射；OpenAI 路径仍保留原有SSE解析。普通JSON原生响应受相同响应/命令/输出界限限制。

`AiHistoryRepository` 将最近50个对话拆分为摘要、显示消息、命令提议和协议消息关系表。恢复历史只允许当前原SSH资产，聊天最多一个活动绑定；旧命令过期、权限重置审核，不执行旧提议。保留活动对话，并用剩余名额保留最近历史。取消与SSH清理独立于历史写入成功；写入失败报告状态/诊断日志。

本地0.2.13已通过262项测试和浏览器流程验证；当前NAS正式版本仍为0.2.12/schema v3。本节取代上文“所有聊天关闭即清空”“只支持OpenAI兼容”的早期限制。


2026-10-21 正式更新：NAS 已运行0.2.13/schema v4。旧业务表数量一致，完整性和外键检查通过，五菜单及供应商/历史API为200，非管理员与无CSRF修改请求403，静态资源与最终打包哈希一致。上文“0.2.13待发布”属于部署前记录，现以本条为准。

2026-10-21 本地0.2.14：系统监控网卡支持“常用 / 物理网卡 / 全部”公共下拉筛选。通过只读sysfs采集硬件归属和链路状态；常用保留默认路由接口及有地址、未断开的物理网卡，避免漏掉fnOS OVS承载接口。实机24个接口中物理网卡3个，默认常用2个。筛选节点不随采样重建，避免操作中断。264项测试、lint、类型、格式检查和打包通过；本地浏览器用实机网卡元数据验证三种筛选，其他监控数据为测试样本。尚未部署NAS，数据库仍为schema v4。

2026-10-21 正式更新0.2.14：用户确认今后完成修改后直接部署NAS。运行依赖锁内容除版本外完全一致，保留数据并替换server/dist及运行清单。部署包重新排除了macOS AppleDouble条目，兼容设备Python旧版解包；服务启动正常。版本API为0.2.14，静态index SHA256为f58fa620d9acaaa374c1e892ac8500a53fe0ce6334d0f323343a106dc2b90721，与发行包一致。五菜单只读接口200，SQLite完整性ok、外键错误0、所有业务表数量与更新前一致。实机执行新监控采集命令得到24接口、3物理网卡、默认路由enp1s0-ovs和wlo1。上条“尚未部署”为发布前状态。

2026-10-21 正式更新0.2.15/schema v5：进程卡片标题简化、PID独立列，CPU/内存列复用公共排序按钮并支持升降序。监控采集各指标双向前五的有界候选集合，避免只在CPU前五内错误地按内存排序。AI协议表单补齐公共表单容器；新增Gemini/GLM/MiniMax/DeepSeek/MiMo，见`docs/integrations/ai-protocols.md`。Markdown、安全过滤、隐藏思考、等待/回复/执行动画和明文Key回填均已实现。官方授权未连接时，OAuth任务类型显示“需官方授权”并禁选，服务端禁止新建此类任务。网络唤醒搜索提示改为“搜索名称或地址”，扫描默认路由所属私网、每次最多两个本地/24或更小网段，32并发有界探测，通过ARP邻居解析单播MAC，支持勾选批量添加；不自动推断设备支持唤醒，不执行唤醒或电源命令。广播地址/UDP字段复用公共表单间距。

验证：282项测试、lint/typecheck/format检查通过。NAS实测MiniMax-M3返回命令提议后可接受固定协议测试结果并继续回答，推理上下文保留但不显示，未执行模型命令。真实局域网扫描返回200，192.168.1.0/24发现8台设备，未自动写入设备配置。所有业务表行数与停机前一致，完整性ok、外键错误0，五菜单、AI供应商和历史API200，未鉴权请求及无CSRF扫描403。运行版本0.2.15，静态index SHA256为6f47d9f71cee93199d466cf867950a50c878376eaea49c7f9f47bb1bea525a2f，与发行包一致。其他供应商仅通过官方协议HTTP夹具，未进行无账号的真实连通性承诺。

2026-10-21 正式更新0.2.16：终端树列表直属帮助提示统一为8px上下、10px左右外边距，与面板标题左边缘对齐，覆盖文件传输空/加载/错误状态及资产/快捷指令空状态。AI面板标题按钮顺序调整为设置、历史、新建、关闭；历史列表项点击后直接恢复至当前聊天，移除历史详情与二次恢复界面，仍沿用原SSH资产匹配、过期旧命令与默认审核规则。权限入口改为盾牌/闪电图标，公共下拉内保留“审核·执行前确认 / 静默·自动执行”文字和无障碍标签。

283项测试、lint及格式检查通过。浏览器核验空提示距容器左侧10px、历史选择后弹窗关闭且消息出现在聊天区、权限可选项保留明确说明。NAS运行0.2.16，前端index SHA256为92b619f65682a10f008b0c3872337d347521a2fb6b2168815c8fa41380a849d8，与打包一致；服务running，五菜单接口200，数据表数量未改变，完整性ok、外键错误0。数据库维持schema v5，此次只更新前端及运行版本信息。

2026-10-21 正式更新0.2.17：API Key继续明文回填，但默认隐藏，复用SSH密码可见性组件；眼睛切换、表单重置恢复隐藏，可见性标签支持API Key。编辑正在使用的连接时，通过公共确认弹窗确认断开，仅关闭捕获的同一连接标签，等待断开完成后打开编辑表单；取消或标签被重新建立时不关闭新标签。权限选择移除Semi空箭头占位，16px图标在32px入口内四周8px居中。286项测试及浏览器实际流程验证通过。NAS 0.2.17服务running、五菜单200，业务表数量保留、完整性ok、外键错误0；前端SHA256为bc6a53bfff690a254475018ad654b2a0762cbaac9bc3a7844c752138b1d77047。

随后0.2.18将网络唤醒筛选文案“已关联SSH”简化为“已关联”，筛选逻辑保持按SSH关联状态处理；浏览器确认新文案。

2026-10-21 正式更新0.2.19：网络唤醒扫描复用公共旋转加载图标，显示“正在扫描局域网…”，完成和失败时移除；扫描入口在请求期间禁用，避免重复触发。AI等待提示与扫描共用loading-indicator组件及公共动画样式。287项测试、lint和格式检查通过；浏览器使用本地有延迟的局域网夹具验证扫描中动画及完成结果切换。NAS运行0.2.19，五菜单只读接口200，服务running，所有业务表行数与停止前一致、完整性ok、外键错误0。前端index SHA256为0a2af4c92ead4b496611b6f70c9391871bc60a31c68f9be7ef47fc07d2fe0ea4，与发行包一致；本次保持后端和schema v5不变。

2026-10-21 正式更新0.2.20：局域网扫描表格不再继承任务页820px最小宽度，使用公共dialog-table样式，选择列40px，宽度随弹窗变化；浏览器实测表格518px与容器一致，消除选择列205px空白及横向溢出。AI设置默认模型复用NativeSelect，支持模型列表和手动创建；根据协议、地址、Key读取模型，测试连接使用尚未保存配置，仅读取模型列表、不保存供应商、不调用对话或SSH。新增POST terminal/ai/test及独立DTO，沿用管理员、CSRF、URL校验、协议适配器和有界请求。变更输入或关闭弹窗后忽略过时结果；修复Semi allowCreate更新候选与值时读取旧选项的问题。288项测试、lint和格式检查通过，浏览器验证两个异步候选均显示且可切换。NAS运行0.2.20，五菜单只读接口200、服务running；在NAS以本地模型夹具验证未保存配置的测试接口，未使用真实第三方Key或发起模型对话。业务表行数保留、数据库完整性ok、外键错误0，schema维持v5。前端index SHA256 c169ae97a942c7971f985f061d35046a0a824cb651739bed2cf486211ff45aae，与发行包一致。

2026-10-21 0.2.21：AI设置去掉供应商行独立删除按钮，供应商下拉每个已保存选项右侧显示删除图标，使用公共选项操作组件；图标点击阻止选中冒泡，保留含供应商名称的确认弹窗，取消不更换供应商，删除其他供应商不重置正在编辑的配置。行内公共下拉容器取消多余14px底部外边距，添加和测试按钮与下拉同高，间距8px（桌面32px、移动40px）。公共密码字段提高右侧40px留白规则优先级，修正被通用输入规则覆盖为12px的问题，覆盖密码隐藏和明文显示两种状态。AI空聊天提示简化为“描述你想检查或处理的任务”。289项测试、lint、格式检查通过；浏览器实测两行按钮和下拉顶部一致、间距8px，密钥padding-right为40px；下拉删除确认取消后配置保留。

0.2.21 NAS部署验收：运行版本0.2.21、服务running，五菜单只读接口200。前端index SHA256 88fa38ee0d5e9479998a486179f785f973a5a2f67896d5aee78a5a9033eef46f与发行包一致。业务表行数保留、完整性ok、外键错误0；只替换前端和运行版本信息，后端及schema v5保持不变。

2026-10-21 正式更新0.2.22：AI设置行尾按钮统一为公共文字按钮，可见文字“新增”和“测试”，title和无障碍标签保留完整含义“新增供应商”“测试连接”。沿用8px间距和既有业务逻辑。构建、2项相关检查通过；浏览器核验可见文字，保存预览。NAS运行0.2.22、服务running、五菜单200，业务表行数保留、数据库完整性ok、外键错误0；前端index SHA256 4416528230a724ee3c0dd4ef705a0bbf342f37a507c37aa0e3ee819291da7d93与发行包一致。本次仅更新前端及版本信息，后端和schema v5不变。

2026-10-21 0.2.22元信息修订：安装包manifest开发者展示字段maintainer从DeskIcons改为kaf，应用ID deskicons与运行数据不变；重新构建发行包，原生包检查通过，并同步既有NAS的/var/apps/deskicons/manifest。服务running、五菜单接口200、数据库完整性ok和外键错误0，元信息修改前后业务表行数相同。

2026-10-21 正式全新安装0.2.23：用户自行卸载并确认完成后，CLI确认Not Installed，通过官方install-fpk安装到存储空间1。manifest开发者maintainer、发布者distributor均为kaf，两项URL均指向https://club.fnnas.com/home.php?mod=space&uid=91804。原生包元信息检查、构建、lint和格式检查通过。官方安装登记版本与运行API均为0.2.23，服务running，五菜单接口200，SQLite完整性ok、外键错误0，前端index SHA256 4416528230a724ee3c0dd4ef705a0bbf342f37a507c37aa0e3ee819291da7d93。FPK SHA256 7690df3de12bca6571a827138419084fa3ec77e5d663876d020f6ac84315bff1。

运维修正：此前仅替换manifest和运行文件的发布记录代表实际运行版本，应用中心登记版本并未随之更新；install-fpk对已安装应用为空操作，并非升级。此次全新安装后登记信息已同步，后续不可仅凭“is installed”认定更新成功。

2026-10-21 运行更新0.2.24：按用户要求取消应用中心更新，通过SSH停止服务、替换运行文件并重新启动，保留数据。新增本地终端命令候选（命令、参数及中文说明），仅在普通Shell提示符且输入已回显时展示；点击只补全剩余文字、不回车执行，保留原生Tab与方向键。应用侧边导航选中底色复用内容区背景变量，移动端底部导航不变。292项测试、lint、格式检查与打包通过；浏览器验证输入doc出现Docker候选，点击后仅填入docker ps。NAS运行API版本0.2.24、服务running，五菜单只读接口均200；22张业务表行数全部保留，完整性ok、外键错误0。前端index SHA256为4ef70e01bc7a29ab2752fb037abcee08aeb509e30173b546d345b4c4da93e35f，与发行包一致。应用中心登记版本仍为0.2.23，本次没有修改登记信息。

2026-10-21 运行更新0.2.25：命令提示改为紧凑左对齐列表，命令与参数区分，复用公共颜色、表单及滚动条；新增系统监控上方的常用命令菜单，搜索与分类同一行，顶部设置和新增加号，支持右键及长按编辑、删除。每个用户首次初始化173条常用命令；之后的修改、删除在重启后保留，不影响其他用户。命令候选和菜单均只填入，不自动回车。资产列表、快捷指令和常用命令的右键删除复用公共danger样式，文件菜单沿用Semi danger类型。

schema v6新增command_catalog、user_preferences、icon_images；命令库、主题、提示开关和图标PNG统一进入SQLite。原图标文件仅在BLOB事务提交并逐字节校验后清理，图标元信息与图片原子保存，删除级联。前端不再使用浏览器持久存储，CLI自行管理的官方授权会话与系统日志继续由外部程序维护。Docker自动地址改用NAS网卡IP，优先当前请求匹配的本机地址或最低metric默认路由，修正原生网关localhost和双网卡枚举顺序；回环地址的Docker标签也会替换为NAS地址。

302项测试、lint、格式检查与原生打包通过；浏览器验证新增、编辑、分类搜索、关闭提示、刷新后设置保留及资产右键红色删除。通过SSH保留数据更新到NAS，运行0.2.25、schema6、服务running；原有业务表行数保留，1张图标的数据库及HTTP返回字节SHA256均与原文件一致，完整性ok、外键错误0，五菜单及命令库、偏好接口均200。真机自动地址为192.168.1.35，命令库173条。前端index SHA256 0df8c6802168e567670b056ec038f0f408de121da021d338566a396fb2c871e0，与发行包一致。FPK SHA256 4ebe1da2eff18fcfb58096b0a250316674703a38b6ec1953fdd2fb0ea114bfe3。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.26：移动端主导航改为白色圆角悬浮条，左右12px，底部12px加系统安全区，64px高；内容区相应预留底部空间。暗色界面中的导航仍使用白色底和可读的灰色文字，选中只改变图标与文字颜色，不恢复触摸底色；键盘弹出隐藏、终端全屏隐藏主导航的逻辑不变。终端共用底部面板将阴影裁切在面板横向和底部边界，保留顶部阴影，避免侧栏在安全区前结束时露出左下角灰块；内容裁切遵循面板圆角，底部留白复用safe-bottom。

构建、3项相关测试、lint与格式检查通过；390px小屏及模拟24px底部安全区预览验证五菜单完整同排、白色悬浮条与安全区间距，以及终端面板底部裁切。此为浏览器布局验证，未替代实体手机的原生WebView验收。通过SSH保留数据更新到NAS，运行0.2.26、服务running、五菜单只读接口200，所有表行数保留，完整性ok、外键错误0，schema维持v6。前端index SHA256 03e62735ee26b651bc040e6f77cd580531737053d9e99e2ff484fc6d62e5b4d6，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.27：移动端悬浮主导航移除阴影，底部外间距从12px调整为8px并保留系统手势安全区；内容区底部预留从88px调整为72px加安全区，仅保留64px导航本身和8px底部间距，取消导航上方额外12px空白。白色底、圆角和左右间距保持不变。构建、2项相关测试及修改文件格式检查通过。SSH保留数据更新，运行0.2.27、服务running，五菜单接口200，25张表行数保留，数据库完整性ok、外键错误0。前端index SHA256为98aebad9e450efb5735588d2dc24d3a8bb8c80d4072eae3015723f4d0e8d4fe4；应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.28：用户截图指出悬浮主导航上方仍有灰色条，定位到移动端.layout main的16px底部内边距；改为padding:16px 8px 0，移除滚动区与菜单之间的多余空白，内容仍在导航上方结束，菜单底部8px加系统安全区不变。构建、2项相关测试、修改文件格式检查通过。SSH保留数据更新，运行0.2.28、服务running，五菜单接口200，25张表行数保留，数据库完整性ok、外键错误0。前端index SHA256为44c189c52391e4afc68318fe85cba830ae681575755057c075eb2db35bd51afb。应用中心登记版本仍为0.2.23；手机实际展示待用户确认。

2026-10-21 运行更新0.2.29：移动端存储管理首页#storage-entry取消重复的左右16px内边距，复用外层公共内容容器的左右留白，使扫描状态、空间分析/重复检查卡片及下方长卡片边缘与其他菜单对齐。仅调整移动端横向几何，保留原上下及卡片内部间距。构建、2项相关测试、修改文件格式检查通过。SSH保留数据更新，运行0.2.29、服务running，五菜单接口200，25张表行数保留，数据库完整性ok、外键错误0。前端index SHA256为12391763b43e0fa9271d9a0817ec18dbe74e01926bd9bec24597db04d0047035；应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.30：按用户提供的悬浮导航参考图，修正内容区在菜单上缘横向截断的问题。主内容延伸至悬浮条周围，导航采用完整胶囊圆角并裁切内部内容；导航仍为白色、无阴影、仅图标文字选中色。五菜单滚动列表共用72px末尾留白及滚动定位间距，确保最后卡片可滚到导航上方；键盘隐藏导航时恢复8px列表末尾留白。390px宽、模拟24px安全区浏览器验证圆弧轮廓及末项可见，截图docs/screenshots/mobile-floating-navigation-v030.png，不代替手机原生WebView验收。构建、2项相关测试及格式检查通过。SSH保留数据更新，运行0.2.30、服务running、五菜单接口200，25张表行数保留，完整性ok、外键错误0。前端index SHA256为eb4ab65a37ea0d975228a6e13e003ed4f18c2b64ec9698f3220f980ea8179ef9，应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.31：按用户补充仅保留悬浮导航顶部弧形边线，取消容器整圈border；伪元素继承胶囊圆角并裁切为上半圈，底部无描边，pointer-events:none不影响菜单点击。构建、2项相关测试及格式检查通过。SSH保留数据更新，运行0.2.31、服务running、五菜单接口200，25张表行数保留，数据库完整性ok、外键错误0。前端index SHA256为14702aca35e4fa60d52e68ec1ba46f77f1ce02cab7beaa80b9ed34ddda1ea71b，应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.32：按用户再次参考示例的要求，为移动端悬浮主导航加入轻微阴影（0 2px 10px，黑色5%），保留顶部上半圈弧形边线，底部无border。构建、2项相关测试及格式检查通过。SSH保留数据更新，运行0.2.32、服务running、五菜单接口200，25张表行数保留，完整性ok、外键错误0。前端index SHA256为5b5c4112ef217607fbacfef342a0f135feea54517b94ead8f6837298b926b169，应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.33：参考用户提供的视频，移动端底部导航采用共享浅灰胶囊选中指示，320ms平滑横向滑动；五枚导航图标独立SVG绘制，选中由线框变为蓝色实心，360ms短促回弹，页面180ms透明度淡入。尊重prefers-reduced-motion关闭动画，保留白色菜单底、轻微阴影、顶部弧形边线。图标状态及指示位置只随当前菜单变化，aria-current同步，不改变业务连接及数据操作；桌面不启用移动动效。新增导航位置/可访问状态及切换动画归属测试，先复现失败再通过。3项相关测试、lint、全项目格式检查及打包通过。390px小屏及模拟24px安全区浏览器核验连续切换后页面/图标/指示一致，截图docs/screenshots/mobile-navigation-motion-v033.png；此为浏览器预览，手机实际动画观感仍需实体WebView确认。SSH保留数据更新，运行0.2.33、服务running、五菜单接口200，25张表行数保留，完整性ok、外键错误0。前端index SHA256为0d86c721051c9f85590f8c40b252d68a1e0650e2ea8c6c67bbdcbec7dbc18867。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.34：新增系统设置，桌面侧栏左下角齿轮进入；移动端第五项改为更多，复用Semi Dropdown向上显示网络唤醒、系统设置，前四项保留，共享选中胶囊位置。设置包含主题、菜单动画、默认初始菜单、命令提示、AI供应商/模型入口、运行版本与开发者/论坛链接、现有第三方许可文本。AI入口复用已有配置表单，为各实例分配唯一字段ID；从系统设置修改供应商后通知已打开AI面板刷新。设置均按账号保存SQLite，主题指定浅/深色不被飞牛配置和系统事件覆盖，跟随系统时继续响应变化。

schema v7仅给user_preferences增加受CHECK约束的default_page、navigation_motion列，保留原偏好和catalog_initialized；兼容v6增量升级，同一事务提交两列及迁移记录，不新增表。默认页只切换展示，不建立SSH连接。305项测试、lint、全项目格式检查及原生构建通过，涵盖偏好持久保存、部分字段更新、用户隔离、v6迁移、非法值与CSRF拒绝。浏览器验证更多向上弹出、主题切换、保存后刷新进入默认菜单、动画开关保留、AI配置/开源许可入口。桌面与390px/模拟24px安全区预览截图位于docs/screenshots/system-settings-v034.png、mobile-more-menu-v034.png。

同版修复用户截图中卡片从悬浮菜单底部露出：在菜单中心线以下以页面背景遮挡，顶部圆弧周围继续露出内容；终端/存储全覆盖及键盘隐藏导航时不创建遮挡。选中胶囊外围间距从8px收紧到4px，图标回弹从原大小开始、最大1.06倍，不再先缩至0.86倍。预览mobile-navigation-bottom-v034.png，浏览器验证不代替实体手机WebView观感。

通过SSH停止、替换server/dist及运行清单、启动完成保留数据更新，NAS运行0.2.34、服务running、五菜单及preferences接口200。数据库schema7、25张表；所有原有业务表行数和既有偏好值保持一致，schema_migrations仅追加一行，完整性ok、外键错误0。前端index SHA256为dc506a71375c5f7b454e015c1ffb05492554cb2acd726f6983335e776fc4771c，与最终发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.35：按用户要求保留NAS内嵌环境的主题快捷按钮，移除初始hidden与SDK内嵌/异常分支隐藏逻辑。侧栏底部版本号在左，主题和设置按钮作为右对齐一组，设置位于主题右侧，间距4px。移动端仍从更多进入系统设置，底部侧栏工具行继续隐藏。构建、3项相关测试、lint、格式检查通过；内嵌浏览器预览确认按钮均显示，独立页面验证主题可切换。截图docs/screenshots/sidebar-footer-v035.png。SSH保留数据更新，运行0.2.35、服务running、五菜单及preferences接口200；25张表行数保持，schema7，完整性ok、外键错误0。前端index SHA256为3693cf9ac0d38776b836af14f69a1f2c34438d3083ed304e5dcec4b6b6ec3a50，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.36：移动底部导航改为5列等宽网格，消除更多的组件包裹层与其他直接按钮混用flex造成的宽度差异；保留56px高、外围4px。存储管理两张扫描卡片的移动边框由主题浅蓝色改为公共中性line颜色。滚动条在shared-scrollbars.css统一定义桌面4px、移动3px、公共颜色与圆角，覆盖Semi轻滚动条尺寸及终端DOM滑块视觉宽度；终端保留原滑动轨道交互范围。Chromium/WebKit使用auto标准属性以应用像素伪元素尺寸，其余浏览器回退thin，不改变原有隐藏横向滤镜条滚动条的行为。参考Chrome官方滚动条说明：https://developer.chrome.com/docs/css-ui/scrollbar-styling 。

更多弹层打开时临时将胶囊和图标选中移动到更多，原菜单临时恢复灰色线框；关闭时按实际页面恢复，选中弹层入口后遵循新页面。实际页面与aria-current不因单纯打开弹层改变。新增索引暂存/恢复测试，4项相关检查、lint、全项目格式检查及打包通过。390px/模拟24px安全区浏览器验证打开更多时内容仍为存储管理，关闭后胶囊回到存储管理，并核验中性边框与细滚动条。截图docs/screenshots/mobile-more-selected-v036.png、mobile-more-restored-v036.png。

SSH保留数据更新NAS，运行0.2.36、服务running、五菜单及preferences接口200；25张表行数保持、schema7、完整性ok、外键错误0。前端index SHA256为4ae569d343f97886ef8f865a5a70c767f16b09d1653c99e7ed86bc8e02f88bc2，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.37：滚动条统一为2px，公共scroll事件捕获覆盖动态挂载的列表、弹窗和Semi下拉；仅实际滚动时显示，停止250ms后淡出，悬浮不触发显示。xterm DOM滑块通过onScroll复用同一活动状态，销毁连接时清理计时器，保留较宽的拖动命中区域。移动端正常菜单的滚动视口延伸到页面边缘，内容保留16px水平留白；SSH/网络唤醒的列表包裹层同步调整，避免滚动条被内层边界裁切。Chromium/WebKit使用2px伪元素，其他引擎回退原生thin。

存储入口卡片增加公共shared-mobile-card类，移除移动端专属渐变、边框、圆角和padding，复用公共背景、16px圆角/内边距及卡片间距变量，只保留图文布局。8项相关测试、lint、全项目格式检查及原生打包通过。390px浏览器预览核验存储滚动视口x=0、宽390px，卡片x=16、内边距16、无边框/渐变，滚动条2px、停止后透明；预览docs/screenshots/mobile-scrollbars-v037.png。实体手机WebView手感仍需用户确认。

SSH保留数据更新NAS，运行0.2.37、服务running、五菜单及preferences接口200；25张表行数全部保持、schema7、完整性ok、外键错误0。前端index SHA256为adb247bc9531986f58e3a83c9671db9d875434f3dfd6ab0e4edd236aa4c46579，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.38：公共滚动条的可见滑块保持2px，使用6px透明轨道及四周2px透明边框，在容器边缘留下2px间隙。通过@property注册可插值的颜色变量，在滚动宿主上过渡，替换原生滚动条伪元素自身的background过渡；停止250ms后进行350ms渐隐，滚动恢复时60ms显现。xterm沿用同样的2px间距及350ms淡出，透明父轨道不再提前隐藏截断子滑块动画。保留减少动态效果设置。参考Chrome滚动条说明及属性注册文档：https://developer.chrome.com/docs/css-ui/scrollbar-styling 、https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Properties_and_values_API/Registering_properties 。

系统设置移除内容区域顶部的重复标题及开源许可入口/弹窗，发行包内第三方许可文件保留。卡片padding改为16px 16px 0，内部标题margin-top归零，避免移动端无边框时外边距折叠；浏览器实测四个分组标题距卡片顶部均16px。截图docs/screenshots/system-settings-v038.png。9项相关测试、lint、格式检查及原生打包通过；浏览器采样核验滚动停止后颜色alpha从0.12经0.114、0.1等连续降低到0，实际滑块2px加外侧2px间距。

SSH停止、替换dist和运行清单、启动完成保留数据更新。NAS运行0.2.38、服务running、五菜单及preferences接口200；25张表行数全部保持、schema7、完整性ok、外键错误0。前端index SHA256为0e8ce7f17182c4d42bc2dfd19ed582ec89346a3cce214cf9e878eac96642f351，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.39：导航胶囊以250ms平滑移动，移除图标上移/缩放回弹及旧nav-page-enter动画。navigation-transition.js通过Web Animations API执行80ms旧页面淡出、160ms新页面淡入，不改变页面位置/尺寸；快速切换取消旧动画并从当前透明度继续，修订序号阻止过期回调显示旧页，切回当前可见页恢复透明度。同菜单重复点击不重播；应用动画关闭及prefers-reduced-motion时直接切换。新增3项过渡行为测试，验证淡出后显示新页、快速切换及减少动态效果。浏览器采样确认旧页透明度降至0后新页从0升至1，图标transform始终none。

桌面图标右留白缺失源于旧#icons-page #cards的padding-right:0覆盖公共规则，已删除。存储管理右留白多6px源于原生滚动轨道占位与16px padding叠加；公共scroll模块增加ResizeObserver读取实际offsetWidth/clientWidth并扣除边框，以局部变量补偿右内边距，页面大小及列表溢出改变时自动更新，隐藏容器归零，不假定浏览器轨道固定宽度。data-scroll-inset用于6个主列表，取代无功能的shared-scrollbar类及存储render中的重复类赋值。合并存储入口被后续规则覆盖的padding、margin、gap、插图尺寸定义，前端模块引用检查未发现孤立模块。390px预览实测桌面图标与存储卡片左右各16px；更多Dropdown spacing为12px，扣除触发器位于导航内部的4px后，弹层距外部导航顶边实测8px。预览docs/screenshots/mobile-navigation-v039.png、mobile-more-spacing-v039.png。

核对项目安装的官方@trimjs/web-app 0.5.0文档/源码：getPlatformConfig().theme读取初始主题，os/theme事件限桌面宿主，$on不支持手机App；项目既有跟随系统、手动选择优先和独立浏览器媒体查询逻辑保持，更新UI依据文档中的过时说明。未将未验证的手机App主题事件或第三方轮询方案作为官方能力。

312项测试、lint、格式检查及原生打包通过。SSH保留数据更新NAS，运行0.2.39、服务running、五菜单及preferences接口200；25张表行数全部保持、schema7、完整性ok、外键错误0。前端index SHA256为71cc80c5b2b33dc69a36525439b864ea1c9b4e80fd00d5b75029e89d26c9adb1，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.40：移动端桌面图标、SSH连接、网络唤醒卡片恢复底部操作行。图标下载/编辑/删除只渲染一组公共CardAction，移除移动专用Dropdown、绝对定位及标题右留白。SSH编辑/删除始终显示，删除仅供移动菜单使用的分支和旧desktop-actions类；计划任务保持多操作Dropdown。网络唤醒移动端将关联设备的关机/重启与编辑/删除放在底部，桌面端仍保留右上角电源菜单及底部编辑/删除。复用40px公共按钮触摸区域，移动操作间距4px，极窄宽度允许操作行换行。

312项测试、lint、格式检查和原生打包通过。320px浏览器核验图标四个按钮、唤醒五个按钮均处于同一底部行，卡片clientWidth=scrollWidth=288px，无横向溢出；图标编辑入口可打开共用面板。390px图标卡片clientWidth=scrollWidth=358px，桌面预览验证唤醒底部只有唤醒/编辑/删除，电源更多菜单仍在右上。未发送唤醒或执行电源操作。截图docs/screenshots/mobile-card-actions-320-v040.png、mobile-card-actions-390-v040.png。

SSH停止、替换dist及运行清单、启动完成保留数据更新。NAS运行0.2.40、服务running、五菜单及preferences接口200；25张表行数全部保持、schema7、完整性ok、外键错误0。前端index SHA256为edbecaa3294a9ab836cd8bbea1000583a1861cce7000ba0502f32664b39b18ab，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-21 运行更新0.2.41：按用户要求移除内容淡出淡入，navigation.js同步切换页面hidden状态，保留同菜单重复点击去重、标题及事件、导航胶囊的250ms平滑移动。删除navigation-transition.js及对应3项旧动画测试；现有导航测试增加animate抛错哨兵，验证即使页面支持动画接口也不再调用，先观察旧实现失败再验证同步实现通过。10项相关测试、lint、格式检查及原生打包通过，源码无navigation-transition/nav-page-enter/nav-content-enter残留。

SSH停止、替换dist和运行清单、启动完成更新。NAS运行0.2.41、服务running、五菜单及preferences接口200；schema7、完整性ok、外键错误0。验收时25张表中22张行数保持，ai_chats从2增至3、ai_chat_messages从22增至24、ai_chat_protocol从26增至29，属于运行期间AI数据新增，不能声称所有表行数完全一致；未替换或清空数据目录。前端index SHA256为4baff408639d8a038ac8c0bda4b74f06434232524539a1595d6b3dc6f95752e9，与发行包一致。应用中心登记版本仍为0.2.23。

运行更新0.2.42：桌面图标新增“管家功能”来源，支持六个一级菜单，复用NativeSelect、图标上传、卡片操作及原有入口安装/下载流程。菜单类型不需要填写地址和打开方式，后端根据枚举白名单生成/app/deskicons/?page=目标&standalone=1，固定iframe并清空containerId，忽略输入中的外部地址，不能借菜单入口注入跳转目标。生成入口配置直接指向主应用统一网关，管理员可见；FPK声明install_dep_apps=deskicons和micro_app=true，开发者/发布者及链接均为kaf，不绑定内网IP。CLI不支持已安装快捷应用升级的原有处理流程保持不变。

独立入口在模块初始化及读取默认页后均优先解析显式菜单，隐藏主侧栏、移动底部导航和遮挡层，桌面内容宽度填满可用区域、手机取消导航预留空间并保留系统安全区。普通主应用继续使用保存的默认页，独立入口不会写入默认页或创建SSH会话；连接列表和工作区功能共用现有实现。非法菜单或重复page参数回退正常应用展示。功能入口使用公共content-sized-editor，桌面按内容收紧；320px来源选项间距8px，三项完整显示，编辑可保留所选菜单，正常来源表单样式继续复用公共字段规则。

schema v8在icons表增量增加可空menu_page，CHECK仅允许六个现有菜单；普通图标存NULL，菜单地址和类型由领域校验规范化，仓库使用绑定参数持久化。迁移不创建新表、不改动旧图标列。测试覆盖规范化、伪造菜单/目标拒绝、独立参数解析、v7迁移及原记录保留、CHECK约束、重开数据库、FPK依赖/相对目标、HTTP创建和读取，314项测试、lint、类型检查、格式检查、原生打包均通过。本地真实下载入口FPK返回200；浏览器验证创建/保存/刷新后编辑、桌面与390px独立SSH界面无导航、320px新增来源无溢出。截图standalone-ssh-v042.png、standalone-ssh-mobile-v042.png、menu-entry-editor-v042.png、menu-entry-mobile-editor-v042.png均在docs/screenshots。测试只创建隔离预览数据，未替用户安装实际桌面入口或发起SSH连接。

SSH停止、替换server/dist及运行清单、启动完成保留数据更新。NAS运行0.2.42、服务running、五菜单及preferences接口200；25张表中仅schema_migrations增加一行，全部业务表行数保持，原图标全部旧字段按排序序列化SHA256与升级前一致；schema8、完整性ok、外键错误0。前端index SHA256为5196aa64218144a8d122a794270c29d830e30e593d63c8cf0b8eb8b577b323b1，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-22 运行更新0.2.43：移动端公共快捷筛选行按横向滚动条实际占位进行负外边距补偿，复用shared-scrollbars的测量与ResizeObserver生命周期。React筛选组件挂载后观察自身尺寸，窗口变化、内容溢出或隐藏状态变化时重新计算；测量剔除边框，悬浮或隐藏滚动条返回0，不写死补偿值，不缩小按钮40px触摸区域，也不改变公共滚动条外观。原有纵向列表右侧补偿继续复用同一测量函数。

新增横向占位/消失/隐藏和观察器更新/释放测试，316项测试、lint、类型及格式检查、原生打包通过。320px浏览器验证：四个筛选选项总宽343px、可视宽240px，正常环境占位0；模拟占位滚动条时测量6px并应用-6px补偿，筛选行布局仍为40px、工具栏仍为92px，卡片顶部与工具栏底部距离16px。水平滚动到scrollLeft=103后布局不变。截图docs/screenshots/mobile-filter-gap-v043.png。该核验使用浏览器模拟占位滚动条，未宣称覆盖所有实体手机WebView。

SSH停止、替换dist和运行清单、启动完成保留数据更新。NAS运行0.2.43、服务running、state及五菜单和preferences接口均200；25张表行数全部保持，schema8、完整性ok、外键错误0。前端index SHA256为8ad4da8f342fc27288560a12d4048c31da5135f028907f458bb089850c202f66，与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-22 名称调整及独立入口首屏修复（0.2.44 / 0.2.45）：桌面图标来源筛选、卡片标签及新入口默认图标来源文字由“NAS 管家功能”改为“NAS 管家”，不更改原记录或入口地址。0.2.44完成316项测试、lint、格式及打包检查并经SSH替换运行文件；更新时先停止正在运行的独立快捷应用，主应用启动后恢复快捷应用，两者running、25张表行数保持、完整性ok。

用户随后反馈独立入口侧边导航一闪而过，定位为静态HTML先显示完整导航、前端模块加载后才添加standalone-entry。0.2.45在统一网关鉴权之后、静态文件中间件之前，对合法独立入口请求生成首屏HTML：根元素直接带standalone-entry，侧栏直接hidden，并且仅目标tool-page不带hidden。不增加内联脚本、不放开鉴权；菜单仍复用领域枚举白名单，重复page、非法菜单及普通入口仍走原静态响应。原前端初始化及普通导航流程保持共用。

新增HTTP回归直接解析不运行脚本的HTML，覆盖根入口、index.html入口、目标页面显隐、普通和非法/重复参数回退；先验证旧响应失败，再完成修复。317项测试、lint、类型、格式检查及原生打包均通过。390px浏览器通过测试代理阻断全部应用JS，仍确认sidebar hidden且display:none、只有terminal-page可见；正常桌面独立SSH入口加载后保持同样状态。未发起SSH连接。首屏截图docs/screenshots/standalone-before-javascript-v045.png。

0.2.45经SSH停止依赖快捷应用及主应用、替换server/dist和运行清单、依次启动并恢复原快捷应用。NAS运行0.2.45，两应用running，state、五菜单和preferences接口200；实机原始独立HTML包含standalone-entry及sidebar hidden，普通HTML均不含。25张表行数全部保持、schema8、完整性ok、外键错误0。前端index SHA256为218644107ac2994fced452d249b8bb7fc26fcdf5f738d5dba59c8671281543eb，entry-document.js为38d718f2ef790950da7791bb617f3d39869bce25add88ab41f93788a8b33b7a3，均与发行包一致。应用中心登记版本仍为0.2.23。

2026-10-22 结构整改0.2.46：按用户批准的六项审查问题收拢公共样式、应用服务和文件管理组件，并对照NestJS/Semi官方文档复核。详细决策及验证边界见architecture-official-review.md，执行清单见architecture-cleanup-plan.md。控制器普通JSON使用标准返回值，业务编排移入应用服务，任务方法改为业务命名；文件流保留Express响应。删除图标Store无效pending/init，存储服务显式幂等关闭且聚合错误，保证先尝试关闭所有工作者、再关闭数据库。

文件管理主组件971→333行，八个模块承接展示/交互/上传/操作/对话框/尺寸等职责。样式通过有序入口按组件归属组织，工具栏/移动卡片清理29条后续覆盖声明，最终2049项原生和1201项存储声明契约保持；修复存储样式悬空选择器。浏览器及Node的ESLint环境分离，前端文件模型、Docker地址、菜单入口纯逻辑增加JSDoc严格检查，全部后端继续TypeScript strict。README更新实际SQLite存储、明文凭据、快捷指令追加回车及SSH部署流程。

337项测试、ESLint、后端及前端关键边界类型检查、Prettier、原生FPK构建通过。独立复查未发现新增HTTP/权限/异步会话/CSS层叠回归；六种宽度计算样式比较无差异。实际浏览器320/390px工具栏/卡片/悬浮导航几何与原版一致，桌面暗色主题、独立SSH入口和移动编辑下拉正常；隔离文件API验证右键菜单danger颜色及创建目录并重新加载，不连接真实主机或操作真实文件。截图architecture-mobile-editor-v046.png、architecture-mobile-storage-v046.png、architecture-desktop-dark-v046.png、architecture-file-menu-v046.png位于docs/screenshots。

0.2.46已通过SSH停止正在运行的独立入口及主应用、替换server/dist和运行清单、依次恢复启动。NAS实际运行0.2.46，两应用running；state、entries、tasks、task-capabilities、programs、terminal connections/workspace/AI providers、storage scans、wake devices及preferences共11个关键接口均200，无管理员网关头访问返回403，独立入口首屏HTML隐藏导航正确。25张表行数全部保持、schema8、完整性ok、外键错误0。前端index SHA256为10e48c9ef86e1da03d6a51ac6a54561fe0da7c5c205d6480459e55b1f60f26a4，与发行包一致。仅更新运行文件，应用中心登记版本仍为0.2.23。

2026-10-22 全量统一0.2.47：全部109个前端业务源文件迁移为TypeScript/TSX并纳入strict，移除旧JS兼容实现。动态卡片、列表、树、标签、弹窗及监控文字由React渲染，原生DOM限于静态宿主与浏览器/xterm适配。建立显式领域/API合同、生成的静态元素合同和AST防回退检查；构建/打包强制检查，测试源码单独编译到.web-test。统一Semi公开组件类型与日期回调，修正重复操作DTO派生字段、改名500上限、旧Docker图标响应覆盖新请求、动态认证图标及销毁顺序。详见full-typescript-ui-review.md。

357项测试全部通过，全前后端strict、109源文件AST审计、ESLint、Prettier及原生FPK构建通过。桌面和320/390px检查卡片、更多菜单、移动面板、存储记录、SSH编辑、密码显示控件和Semi时间选择器。使用隔离预览数据，不发起真实主机连接、电源操作或扫描删除。

0.2.47经SSH停止既有独立入口及主应用、替换server/dist和运行清单后恢复运行；未使用应用中心更新。NAS主应用及deskicon.c47d5444d9a1c688均running，实际运行版本0.2.47。state、entries、tasks、task-capabilities、programs、terminal connections/workspace/AI providers、storage scans、wake devices、preferences共11接口200，未授权请求403，独立入口首屏隐藏导航。25张表行数全部保持，schema8、integrity_check=ok、foreign_key_check=0。dist/index.html SHA256为42ec7671bc27592cd8c347d88272b521920781572a3f389688ca6c0fcfad82ce，与本地发行包一致。应用中心登记版本仍为0.2.23，不能将运行文件更新视为登记元数据更新。截图typescript-desktop-v047.png位于docs/screenshots。

2026-10-22 复核及界面清理0.2.48：删除侧栏底部主题快捷按钮、点击处理、失效CSS和静态类型契约；系统设置中的主题选项和飞牛/系统主题同步保留。当前既定约束复核未发现新问题，全前后端strict、109前端源文件AST审计、ESLint、Prettier、357项测试及FPK构建通过。浏览器确认底部仅保留设置按钮且设置主题下拉正常。复核范围和限制见standards-review-v048.md。

通过SSH停止独立入口和主应用、替换server/dist及运行清单后依次恢复；未通过应用中心更新。NAS实际运行0.2.48，两应用running，11关键接口200，未授权请求403；独立入口初始HTML导航隐藏正确且不存在theme-toggle。25表行数全部保持，schema8、完整性ok、外键错误0。dist/index.html SHA256为3c06d87f641bfa68f775f914753ca594648641c8600adc2e553ca1231f30c699，与本地发行包一致；应用中心登记仍为0.2.23。截图sidebar-theme-removed-v048.png位于docs/screenshots。

2026-10-22 行为缺陷复查0.2.49：基线357项测试通过后，独立时序审查仍复现三个实际缺陷：计划任务切换类型旧响应覆盖当前目标；旧保存响应关闭重开的编辑器/向新表单写错误；同名上传取消仍提示上传完成。已修复并增加7项回归，包含旧代码先失败的证据。最终364项测试全部通过，strict、109前端源文件AST审计、ESLint、Prettier及原生FPK构建通过。详情见defect-review-v049.md。

经SSH停止原独立入口和主应用、替换server/dist和运行清单后依次恢复。NAS实际运行0.2.49，主应用及独立入口均running，11关键接口200，未授权请求403；独立首屏导航隐藏正常且无主题快捷按钮。25表行数全部保持，schema8、完整性ok、外键错误0。dist/index.html SHA256为5fb6cef5a7e8c31a4304bbf2e01ba27ab8b103fb54e57e75cf2c9ec7869a394a，与发行包一致。保留用户数据，未使用应用中心更新，登记版本仍为0.2.23。本轮未执行真实SSH命令/电源操作或用户文件上传删除。

2026-10-22 异常路径复查0.2.50：发现并修复五项实际缺陷：重复文件被替换为FIFO后阻塞、目录解析期间关闭后仍启动处理、下载已交付但记录等待源流关闭、源流失败误记取消、AI历史同毫秒按随机ID错误排序及裁剪。重复处理非阻塞打开并验证普通文件；SIGTERM回滚宽限5秒后SIGKILL兜底，spawn前再次检查关闭状态。下载以响应finish标记完成并按首先发生的源错误/客户端关闭区分状态。AI历史事务按账号生成单调更新时间，不改schema。新增10项回归含旧实现失败证据；最终374项测试、strict、109文件审计、ESLint、Prettier及原生FPK构建通过，详见defect-review-v050.md。

按既有SSH停止独立入口/主应用、替换server/dist及运行清单、依次恢复流程更新，保留用户数据。NAS实际运行0.2.50，主应用和独立入口均running，11关键接口200，未授权403，独立首屏导航及主题按钮状态正确。25表行数保持、schema8、完整性ok、外键错误0。dist/index.html SHA256为5fb6cef5a7e8c31a4304bbf2e01ba27ab8b103fb54e57e75cf2c9ec7869a394a；server/storage/duplicates.js为ca923e0dc9f1b025c050b3e889a2d88fcda62b2e37a29dd646816190a912a593；duplicates-worker.py为bea9a3ae11a6099cbe44eb4418d7a849355528b154d325676a6764f66f6fe1b6；terminal.controller.js为72a6831913a01333abfaa16d58497cc99029400e052f7ac9155303cb69799917；ai-history.repository.js为8ab9db2852a01021b1b4f3099a8121141954acd88424e15b654fc927f8ff1570，全部与发行包一致。应用中心登记仍0.2.23，未通过应用中心更新。本轮异常复现仅隔离临时目录，不操作NAS用户文件或外部AI服务。

2026-10-22 并发及取消复查0.2.51：修复四类实际缺陷：AI跨终端迟到取消中断新轮次、供应商保存/删除关闭弹窗后漏同步、忙碌结束历史仍禁用、网络唤醒关闭时未取消/等待整批及后续写入。AI每session mutation队列与取消屏障隔离请求顺序，真正派发前重新验证target/disposed；统一清理取消仍可完成。设置成功始终同步存活workspace，历史随状态刷新。唤醒以服务级取消、批次追踪、关闭标记完成停止与排空，合并调用者signal且保持隔离。新增15项回归，最终389项测试、strict、109前端审计、ESLint、Prettier及FPK构建通过，详情见defect-review-v051.md。

SSH停止独立入口及主应用、替换server/dist/运行清单、依次恢复完成。NAS实际运行0.2.51，两应用running，11关键接口200、未授权403，独立首屏及主题图标状态保持。25表行数保持，schema8、完整性ok、外键错误0。dist/index.html SHA256为53fbb2005bab6ef957e2d52a55c610d90be19aafe2fe6404f88b540be56f7daa，server/wol.js为28ac80ebc90625abee7f54de5788a0fa89b0c3708ad6b358f90368a283ba755e，均与发行包一致；上轮四个关键后端文件哈希也一致。保留用户数据，未通过应用中心更新，登记版本仍0.2.23；未执行真实设备电源操作、文件修改或外部AI请求。

2026-10-22 授权按钮统一0.2.52：生成授权链接、完成连接、断开连接采用公共dialog-action，与dialog-footer共用桌面32px/min-width72px及移动40px规则。清理授权按钮ID的局部对齐/间距及危险色定义，断开使用公共danger类，右对齐和16px间距归入公共按钮布局。桌面实际计算样式核验三按钮32px、字号14px；390px面板视觉验收正常。截图及说明见official-actions-v052.md。389项测试、strict、109前端审计、ESLint、Prettier和FPK构建通过。

SSH保留数据更新完成，NAS实际运行0.2.52，主应用及独立入口均running，11关键接口200，未授权403，独立首屏及主题按钮状态正确。25表行数保持，schema8、完整性ok、外键错误0；dist/index.html SHA256为b26933237364abf2bf40f1e5227b1819b15cdacf8c63292a4a1a23e7d8922506，与发行包一致。上轮关键后端文件及wol哈希保持。未使用应用中心更新，登记仍0.2.23；本轮仅打开隔离授权面板，未连接真实官方授权。

2026-10-22 移动键盘布局调整0.2.53：移动端focusin同步隐藏底部导航，不再等视口缩小阈值；保留视口检测以在失焦且键盘收起后恢复，输入框仍聚焦时继续隐藏。清理键盘状态下主区域高度/margin及列表/设置底部72px→8px留白切换，避免二次布局。不增加键盘高度补偿或主动滚动。新增DOM事件回归先失败后通过，最终390项测试、strict、前端AST、lint、格式及FPK构建通过。真机输入法流畅度待用户手动验收，详见mobile-keyboard-v053.md。

SSH保留数据更新完成，主应用及独立入口running，实际运行0.2.53；11关键接口200，未授权403，25表行数保持、schema8、完整性ok、外键错误0。dist/index.html SHA256 d25daddd91515dc48b4afedc1a5690bf5624482b078db57c06c327eaf2bf64af，与发行包一致。未使用应用中心更新，登记版本仍0.2.23。

2026-10-22 用户要求撤销上一轮键盘调整：源代码、相关样式、测试及发行版本恢复0.2.52，保留其他既有功能及数据。移除0.2.53新增的同步隐藏行为测试，恢复原先视口阈值检测和键盘状态布局规则。389项测试、strict类型、AST审计、lint、格式及FPK构建通过；本地dist/index哈希与原0.2.52一致。

通过SSH停止独立入口与主应用、使用原0.2.52归档替换运行文件并依次恢复启动。主应用和独立入口均running，实际运行0.2.52，11个关键接口200，未授权403。25表行数保持，schema8、integrity_check=ok、foreign_key_check=0。前端index SHA256 b26933237364abf2bf40f1e5227b1819b15cdacf8c63292a4a1a23e7d8922506。未使用应用中心更新，登记仍0.2.23；0.2.53说明文档标记为已撤销。

2026-10-22 同版本元信息重打包：按用户要求保持0.2.52，开发者kaf的maintainer_url改为https://github.com/kaf931/fnos-manager，发布者及论坛链接保持。应用说明补全五个主要功能、独立桌面入口、终端文件传输和AI能力及PC/移动适配。新生成的快捷入口包同步开发者链接，相关文档及项目偏好同步。389项测试、strict、lint、格式和原生FPK构建通过，并从最终FPK读取manifest核对版本、两个链接和说明；包SHA256为82069ab5a99c990b833580c8d4b29a3fe6cfa1875e8843f107b86da6614556d8。

用户随后明确本次只需提供包、由其手动安装。在该消息到达前SSH替换流程已启动并完成：主服务running，运行版本0.2.52，11关键接口200，未授权403，25表行数保持、schema8、完整性ok、外键错误0；server/package.js SHA256 c096a83a394aaa1c7feb2f250d94b22dd16fb70dbb7b4edea492f8403ffa0133与本地一致。原快捷入口查询返回noinstall，未尝试重装。此后仅核验本地安装包并交付，不执行安装或应用中心元数据更新；应用中心展示信息由用户手动安装后生效。

2026-10-22 用户确认已卸载并明确要求安装后，先确认deskicons为noinstall，再上传并校验0.2.52 FPK，使用install-fpk完成全新安装并启动。安装包SHA256为82069ab5a99c990b833580c8d4b29a3fe6cfa1875e8843f107b86da6614556d8。NAS登记manifest已实际更新为0.2.52，开发者链接为GitHub仓库，发布者为论坛主页，描述为新版完整功能说明。服务running、API实际版本0.2.52、11关键接口200、未授权403；数据库25表、schema8、完整性ok、外键错误0。此次为用户卸载后的新装，未将其描述为保留数据升级或原表行数保持。

2026-10-22 生命周期数据处理补全，保持0.2.52：增加官方wizard/uninstall的keep/delete单选，默认保留；安装回调复用DatabaseService初始化/迁移，升级前停服务并检查完整性，升级后迁移复查，卸载前停服务并按选择处理。生命周期TypeScript校验三个同空间专属数据根目录、拒绝重定向及数据库链接，明确删除仅清理其内容。损坏数据或停止失败时中止，不以空库覆盖。脚本由scripts/lifecycle-hooks.js统一生成，打包复制JSON向导。9项新增回归覆盖保留、清理、路径拒绝、损坏、schema7迁移及停止失败；全398项测试、strict、AST、lint、格式及FPK构建通过，代码复核无阻塞问题。最终FPK SHA256为0d327ebcc515d099aea34e49a5eb7e316a7fe3e9dbc1c3cd07b2c49d5eee3db3。

NAS隔离应用kaf.lifecycle.probe052验证系统卸载保留三个数据目录，网页向导两选项及默认保留显示正常；网页按保留卸载后FPK重装，SQLite测试记录仍在。明确delete通过隔离实际脚本验证清空三个目录；未在网页选择永久删除。隔离应用已卸载，未卸载主应用。带向导的CLI卸载会要求转Web UI且可能退出码0，按状态验收，详见integrations/application-lifecycle.md。截图uninstall-data-wizard-v052.png。

通过SSH停止主应用、检查既有数据库、替换server/dist/运行清单及cmd/wizard、执行升级回调并启动，未经过应用中心升级。主应用running、运行/登记均0.2.52（登记来自此前全新安装），11关键接口200、未授权403、25表行数保持、schema8、完整性ok、外键错误0。server/lifecycle.js SHA256为044fb520841ab5f810f3852dcacc7720157ec4776e18c382564cc6d9e115cf18，卸载向导为9c534aa46c979ae9329fa42e83b5584edc919fe5305209be8f1bef06a8069795，前端index及关键后端旧功能哈希保持；当前数据完整保留。

2026-10-22 AI聊天呈现优化（保持0.2.52）：正在思考/回复/执行命令等活动状态移入滚动消息流，以公共assistant消息布局展示在下一条回复位置，移除聊天区外的固定底部Loading；无历史且等待时不同时显示空态提示，回复或结束后移除占位。命令审核继续固定输入框上方。模型显示标签改为完整模型名，不再添加供应商名称和分隔斜线；内部选项仍用providerId+model复合标识，模型名本身含斜线不截断，同名不同供应商保持独立。

新增DOM回归验证等待占位在对话内、完成后消失，以及模型标签/复合身份回归；旧实现先失败。最终400项测试、strict、AST审计、lint、格式及FPK构建通过。隔离浏览器预览使用真实mountTerminalAi和公共样式，模拟等待到回复、展开模型列表，确认只显示MiniMax-M2.5/MiniMax-M3；未连接真实SSH或AI供应商。截图ai-thinking-message-v052.png、ai-model-label-v052.png。

SSH停止主服务、替换前端dist后启动完成，数据保持。NAS服务running，运行/登记仍0.2.52，11关键接口200、未授权403，25表行数保持、schema8、完整性ok、外键错误0。dist/index SHA256为236ae82f993a106e01da3b5d5b2aba092356f5645a7297aa0e15711a5d6b3907，与本地一致；FPK SHA256为083f3a9c73831cde9244d0329e48553aa8c9cc1f253344dcf3a873246ff234f7。生命周期及既有后端功能不变。

2026-10-22 AI回复空行修正（保持0.2.52）：用户实测等待时多出一行AI标题，根因为空assistant消息仍渲染small标题，再追加等待占位。消息流现在过滤无文本且无已完成/拒绝/失效命令卡片的消息，保留有实际命令结果的消息。已有assistant文本时不显示“正在回复”，等待和实际执行命令的活动提示保留。扩展既有DOM回归以包含空assistant并确认只有一个AI消息占位；修改状态回归断言抑制“正在回复”，旧实现分别先失败。全400项测试、strict、AST、lint、格式及FPK构建通过。

隔离浏览器以空assistant+busy快照确认仅一行AI及正在思考；在busy仍为true时填入回复，确认等待提示消失且没有“正在回复”，不调用真实AI或SSH。截图ai-empty-message-fixed-v052.png。SSH停止主应用、替换dist、启动后服务running，运行/登记仍0.2.52，11关键接口200、未授权403，25表行数保持、schema8、完整性ok、外键错误0。dist/index SHA256为3c465825ff5546d7e5c57da5103972ce52f598a66189e192fa52ec1d51a8587d，与本地一致；FPK SHA256为f814a1d237e6512bfbc6765ded1e48743baaa05f904c513d1846d8d5e5c52d0d。当前数据保留，生命周期及后端不变。

2026-10-22 AI 附件功能（保持 0.2.52 / schema9）：输入框新增附件图标，支持文件选择、拖入和粘贴图片；消息附件展示名称及大小，草稿可移除，附件可单独发送。文本/日志/代码每个256KiB、静态PNG/JPEG/WebP每个2MiB、每条最多4个且总4MiB。前后端共用限额，后端验证真实图片格式和像素数；各协议使用各自视觉消息格式。DeepSeek及MiniMax M2图片请求明确拒绝，不静默丢弃。对话中附件视为分析数据，命令执行权限不因附件内容改变。

按用户最新要求，附件原文件保存在应用数据目录ai/attachments，SQLite仅新增STRICT元数据表ai_chat_attachments，含账号/对话/消息/协议外键、大小、UUID及SHA-256，不包含附件正文列。文件0600、目录0700；原子发布且拒绝覆盖、读取校验、SQL失败回滚新文件、历史淘汰后清理无引用文件；卸载保留/删除沿用整个数据目录规则。新增回归覆盖保存失败的消息不会留在内存历史，用户移除失败附件后重试不会把旧附件发给模型。异步读取按SSH选择和草稿代次隔离；提交失败保留草稿。

409项测试、strict类型、前端AST、ESLint、Prettier、FPK构建通过；独立代码复核发现的失败重试问题已修复并复核。隔离浏览器检查附件摘要及工具栏布局，截图ai-attachments-v052.png；扩展未启用文件URL权限，文件选择器自动填入未完成，未修改其权限，选择/粘贴/拖入行为由组件测试覆盖。未向真实模型服务发送测试附件。详见integrations/ai-attachments.md。

通过SSH停止服务、替换server/dist及运行清单后启动，没有应用中心更新。运行及登记版本均仍0.2.52（登记来自此前全新安装），schema8→9、表数25→26；所有旧业务表行数保持，迁移表仅增版本9一行，附件元数据初始为空；integrity_check=ok、foreign_key_check=0。11个关键接口200、未授权403、独立入口首屏隐藏导航及主题图标状态正确。NAS隔离临时数据库完成真实Linux文本/图片写入、重新打开恢复、文件0600和元数据无正文校验，测试目录已清理，不写入正式聊天。正式附件目录0700。前端index SHA256 fd923eb4c4e5a8dbcf249b23a9c0b794e3d9d3ea9c2dadb596f3d75feba23858，FPK SHA256 98c35a81d42daf3b4ae72503ba28c678e347dcc38b5c00097e3c4401a67dbc14。

2026-10-22 附件 HTTP 兼容及存储管理联动（保持0.2.52/schema10）：复现 NAS 普通 HTTP 页面缺失 crypto.randomUUID；前端草稿改为页面内递增标识，后端持久文件仍使用安全 UUID。真实 LAN HTTP 浏览器显示安全上下文false/randomUUID undefined时，实际readAiFiles正常读取文本附件。新增存储管理首页“应用附件”长卡片和公共管理弹窗，支持占用统计、名称/会话搜索、类型及7/30/90天前筛选、选择清理及无引用清理；移动卡片/加载更多，桌面公共表格/分页，无新建专属样式。

AiAttachmentRepository提供所属账号分页与过滤；清理先标记deleted_at，再清理无引用文件。metadata保留墓碑，恢复历史跳过正文并显示已清理，不会复活文件；清理同时同步空闲活动对话上下文，阻止处理/待审核命令中的聊天清理，不替换其他生成中会话的消息对象。后者经审查发现并用先失败后通过的流式回归修复。StorageModule导入TerminalModule的AI应用服务，共用身份及CSRF守卫；新增三个显式Nest端点，架构审计登记101个handler。

schema9→10事务增加附件created_at/deleted_at及查询索引，保留原表与文件，仍26表。417项全量测试通过，最终表格和搜索框公共样式调整后24项相关测试再次通过；strict/AST、ESLint、Prettier及FPK构建通过，代码复核无阻塞问题。浏览器预览截图storage-attachments-v052.png；未在正式数据上执行清理，也没有发送模型付费请求。

SSH停止主服务、校验更新前数据库、替换server/dist及运行清单并启动，未经过应用中心更新；运行/登记均保持0.2.52，服务running。26表全部业务行数保持，schema_migrations仅增版本10；integrity_check=ok、foreign_key_check=0，含新附件列表在内12个关键接口200、未授权403，独立入口首屏及主题图标状态不变。NAS隔离临时数据库实测附件清理后实体文件消失、旧内存历史再次保存不会复活、关闭重开后聊天文字及已清理标记正确；隔离目录已清理。前端index SHA256 f5f08608499685d5a226d1cc1d3b6e7c007327fc72e2b0c8382fbc804eeb1f40，FPK SHA256 9ff252818c60c53c52d0da5ecde3fe1d5f2c598738c9028fb6df91d1c4eaaca3。


2026-10-22 SSH AI Skills（保持0.2.52/schema11）：新增单文件SKILL.md导入、新增、编辑、删除及显式启停，默认禁用；前端复用公共AI弹窗、选择器及移动底部面板。固定yaml2.9.1解析前置信息，拒绝重复键、别名和非法格式。SQLite新增STRICT ai_skills结构化配置表，按账号隔离、名称唯一；不是附件原文件入库。模型先接收启用名称/描述，再通过只读read_skill按需加载正文；四种协议工具声明、调用及结果配对统一处理，保持SSH审核/静默权限。每条新用户消息刷新技能目录和历史正文，加载去重并计入工具轮次限制。当前不支持技能目录资源包或脚本执行。详见integrations/ai-skills.md。

复核发现的混合技能/SSH调用历史恢复缺失结果及详情读取失败后旧草稿覆盖问题已修复并增加回归。432项全量测试、strict类型、前端AST、ESLint、Prettier及FPK构建通过。浏览器隔离预览验证界面与停用保存状态，截图ai-skills-v052.png；没有向真实模型请求或执行测试SSH命令。

SSH停止主服务、核验更新前数据库、替换server/dist/运行清单及新增yaml依赖后启动完成；运行/登记均保持0.2.52（登记来自此前全新安装），服务running，未通过应用中心更新。schema10→11、表数26→27；所有旧业务表行数保持，schema_migrations仅增版本11，ai_skills初始为空；完整性ok、外键错误0。13关键接口200、未授权403、独立首屏及主题按钮状态正确。NAS隔离临时数据库验证技能持久恢复、账号隔离、渐进加载及命令待审核，零命令执行；临时目录及部署暂存文件已清理。前端index SHA256 338ccdfe2dd0f356727a40258ade1aeaca7ad7cf6f319fbd03d40077d355bb32；FPK SHA256 a257573aad990aac8dd50520e3f5de60ae2b2be9e67b8da41bf27d75adf0fa01；运行归档SHA256 70dd56cb1e1b54c9c65fc0349343b16d6f4248b5c3f7be5d3850bec17d6e5515。


2026-10-22 聊天图片预览及入口调整（保持0.2.52/schema11）：发送前及聊天消息显示PNG/JPEG/WebP缩略图，点击公共原生弹窗放大，历史按需通过所属账号预览接口读取；不在轮询快照或SQLite中存图片正文。新增GET terminal/ai/attachments/:attachmentId/preview，沿用管理员/账号守卫、no-store响应和现有私有文件大小/SHA-256校验，拒绝其他账号、文本、缺失/损坏或已清理文件。组件卸载、附件切换后忽略旧响应；清理后不再展示图片。附件按钮移至审核/静默按钮右侧，发送/停止独立靠右；系统设置AI接入新增Skills管理入口，复用已有组件；按用户最新要求保留各面板关闭按钮。

新增API与DOM行为回归先失败后通过，434项全量测试、strict/113前端源文件AST、ESLint、Prettier及FPK构建通过，独立代码审查无重要问题。实际组件/发行公共CSS的桌面和390px宽度浏览器预览确认缩略图与放大关闭正常，截图ai-image-preview-mobile-v052.png。未向外部模型发送图片或执行SSH命令。

SSH停止主应用、核验数据库、替换server/dist后启动，保留全部数据，未通过应用中心更新。运行/登记版本均仍0.2.52，服务running；schema11、27表所有行数保持，integrity_check=ok、foreign_key_check=0；13关键接口200、未授权403，独立入口首屏和主题按钮状态保持。NAS隔离临时应用验证真实图片字节/no-store、账号隔离、未授权403和清理后404，临时数据库及部署暂存文件已清理。前端index SHA256 70648acaed055c347c36fe5c355493e088eaaf8e1bffdb365e41693c0564710e；FPK SHA256 ffd93c42374063c63c607d5e2661bb0743ce30c47f568833fc3d948a23d64e06；运行归档SHA256 314bbed7be8cc2b64ceb451c319247679e83805cb36bc6ad12a0b7115e518ffe。


2026-10-22 AI名称、历史滚动及图标控件统一（保持0.2.52）：界面AI助手简化为AI。历史弹窗根因是父级block/overflow:hidden，列表clientHeight与scrollHeight同为4340px而弹窗仅1166px，导致裁切且没有列表滚动范围。复用公共dialog-scroll-surface弹性纵向/最大高度布局，使列表独立滚动、标题及底部操作不收缩；继续采用公共滚动条。桌面和390px移动底部面板均实测滚动至第50条。附件与审核按钮统一32px、3px公共圆角及fill-0底色；AI图标按钮和权限选择接入Semi Tooltip，发送/停止单独靠右，关闭按钮保留。基础图标forwardRef与Semi提示层分离，非AI使用方不新增Semi依赖。

标题回归先失败后通过，434项全量测试、strict/114前端AST、ESLint、Prettier、FPK构建通过；浏览器实测滚动与计算样式，附件提示可见。说明见integrations/ai-history-layout.md，截图ai-history-scroll-mobile-v052.png、ai-controls-tooltip-v052.png。

NAS验收：通过SSH停止服务、仅替换dist并启动，保留当前数据，未通过应用中心更新。服务running，运行及登记仍0.2.52；schema11、27表行数全部保持，数据库完整性ok、外键错误0；13关键接口200、未授权403，独立首屏导航及主题按钮状态保持。部署暂存文件已清理。前端index SHA256 04598134ef154fe56b54159da103478b9b86ea0aac778e5311f061ec6270e5de；FPK SHA256 e1b3b7b13ad4140bd224cd7775c27809e1d0d09339b2d742f1210c24788bca82；前端运行归档SHA256 b5692882c1317023a20102137eba3f9f5bf5f6152a1bb88c1daf29bd284b1f69。


2026-10-22 应用附件管理布局统一（保持0.2.52）：按用户确认仅调整管理弹窗，首页入口不改。公共storage-record-manager正文顶部留白收紧、左右24px对齐，统计移入底部；搜索复用search壳和图标、筛选使用toolbar-select-group及NativeSelect，移动完整显示类型/时间。桌面表格复用dialog-table及公共列宽，为名称保留主要空间。移动端复用storage-history-selectable/history-record-card，外侧选择框与整卡选择同步，使用中附件禁选；文字支持换行，不新增附件主题。

浏览器还复现筛选及分页下拉被原生dialog顶层遮挡，使用Semi ConfigProvider在本面板内统一挂载弹出层到dialog，实际类型及分页选项恢复可见和可选。新增移动整卡选择回归先失败后通过，435项全量测试、strict/114前端AST、ESLint、Prettier和FPK构建通过；桌面及390px浏览器验收截图storage-attachments-desktop-layout-v052.png、storage-attachments-mobile-layout-v052.png，未操作真实附件清理。

NAS验收：经SSH停止服务、仅替换dist并启动完成，未使用应用中心更新；服务running，运行及登记0.2.52，schema11/27表行数全部保持，数据库完整性ok、外键错误0；13关键接口200、未授权403，独立首屏及主题按钮状态保持。没有清理正式附件或更改聊天记录，部署暂存目录已清理。前端index SHA256 d54fdc97bfd1ee4f673e6c3b098e778c975b61c44b370d0ca4eb730748c81bbf；FPK SHA256 d9930e7be24897b3a245e1fd7cd6d891d28216f8a1249428023120a70f4ee35a；运行归档SHA256 34ae3ee5519729a6059a7c22aab88afd2ff32f0854385be737419594a0adcb42。

### 2026-10-23 技能包实机迁移

完整技能包上线，SQLite user_version=12、30张表；技能正文/包索引/授权元数据保存在SQLite，包资源保存在应用数据目录，运行准备通过当前SSH账号的SFTP完成。旧业务行数保持，完整性和外键检查通过。具体验收及摘要见 [AI Skills](integrations/ai-skills.md#2026-10-23-完整技能包部署验收)。

### 2026-10-23 对话技能安装与附件schema13

AI通过inspect_skill_package读取当前聊天ZIP或下载链接，通过install_skill_package提案安装并启用。写入复用既有审核/静默执行通道；ZIP作为archive附件使用文件存储，SQLite元数据表迁移至13，表数仍30。资源、运行准备与官方授权沿用现有服务。
