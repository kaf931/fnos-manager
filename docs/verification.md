# 验证记录 · 2026-10-18

环境：飞牛 fnOS 1.2.0800，x86_64，官方 Node.js 22 运行时。

- `npm test`：10 项通过，0 失败。
- `npm run build`：生产构建成功。
- `npm run pack`：生成约 14 MB 原生 FPK。
- `npm audit --omit=dev`：0 个已知漏洞。
- 实机通过统一网关打开管理界面；读取 11 个真实容器（9 个运行中）。
- 选择 LibreTV 后自动填写 18080 端口地址并获取网页图标。
- 生成、安装快捷入口后，浏览器 DOM 确认飞牛桌面出现 LibreTV；从该图标打开目标应用成功。
- 已安装入口更新通过，安装版本和管理数据的 appliedRevision 均为 2。
- 临时入口实际安装、等待 running、立即删除通过；确认对应 /var/apps 目录和管理记录均已删除。
- 最终保留一个 LibreTV 快捷入口与“桌面图标”管理器，两者系统状态均为 running。
- 安装包暂存代码与设备 server/native.js、server/index.js、server/package.js SHA256 一致。
- 项目源码和文档未包含 SSH 密码。

当前原生版本需要 root 权限操作官方应用中心及 Docker，只监听受网关保护的 Unix Socket；管理 API 校验管理员与会话令牌。新版本安装失败自动恢复旧包的代码已实现，未通过主动制造设备安装失败进行实机故障注入。

未验证：ARM 设备、FN Connect 跨网访问、其他 fnOS 版本。没有修改飞牛系统页面。管理页面细节参照系统界面，只有入口、图标与 SDK 接入属于公开规范。

截图：screenshots/native-app.jpg

## 0.2.0 计划任务（2026-10-18）

- `npm test`：18/18 通过，覆盖时区、任务校验、危险操作确认、官方固定参数、并发去重、历史持久化、脚本超时及忽略 SIGTERM 的后代进程清理。
- `npm run build`、`npm run pack`：通过；运行时 npm audit 0 漏洞。
- fnOS 1.2.0800 x86_64 已部署更新；原 LibreTV 图标保留。只读读取 43 个可控程序、11 个容器。
- 实机单次脚本任务：计划 22:30:19，22:30:21 执行成功，输出 fnOS-scheduler-native-ok；任务执行后自动暂停，没有数据操作。
- 重启、回收站、日志清理只执行调用预览，确认参数分别为 power reboot --yes、file trash clear --yes、logger clear --level N --module N --yes，未执行真实操作。
- 官方 CLI 0.5.0 二进制版本与 SHA256 校验通过；实机授权链接生成通过。用户未提供 OAuth code，未测试授权兑换与上述真实系统操作。
- 独立代码审查发现并修复：超时后主进程退出导致强杀计时器被取消；程序 restart 第二次 start 的 [Error] 响应漏判。
- 更新前备份仅本应用文件及图标数据至 NAS /tmp/deskicons-before-v0.2.tar.gz。采用开发部署更新自身服务，未卸载用户应用。
- 缓存、官方备份、快照创建无已确认公开调用入口，内置类型不可创建，不声称已完成这三项集成。

## 0.2.1 UI 对齐

- 官方页面交互文档已读取并用于主题初始化/事件、标题、未保存提示；取样及限制见 docs/integrations/ui-alignment.md。
- 在 fnOS Docker 原生 DOM 上测量控件，保存亮暗主题源变量，并用于 web/fnos-theme.css；控件映射在 web/native-ui.css。
- 本地亮/暗模式与新建任务表单已视觉检查；实机新建任务按钮计算样式为 rgb(0,102,255)、28px 高、6px 圆角、14px 字号，与官方工具栏实测对应。
- npm run build、npm run pack 成功，18 项现有功能测试通过；没有运行真实系统清理或重启任务。
- 本次只更新本应用界面与版本号，保留原图标和任务数据，更新前备份位于 NAS /tmp/deskicons-before-v021-ui.tar.gz。
- 飞牛桌面宿主内已核验 setTitle：窗口从“桌面图标 - NAS 工具箱”切换为“计划任务 - NAS 工具箱”；宿主内隐藏手动主题覆盖按钮。
- 表单输入未保存内容后关闭应用，实机显示官方 Semi 宿主确认框“离开应用？尚有未保存的内容，离开后将丢失。”；取消后恢复并关闭测试表单，未创建实际任务。

## 本地表格与分页调整

用户明确要求暂不部署 NAS。本轮只修改本地源码、依赖和 dist，没有上传或安装。

- 移除两页顶部统计说明行、计划任务授权说明行及“查看各项功能的官方接入状态”区块。
- 参照用户提供的飞牛日志截图：单行搜索/状态筛选/操作工具栏，紧凑白底表头，列分隔，数据区独立滚动，底部左侧刷新与总数，右侧翻页、页容量、跳页。
- 采用 Semi Design 官方 Pagination（@douyinfe/semi-ui 2.104.0，React 18.3.1），并使用已经记录的飞牛主题变量。它是 Semi 官方组件，不将其宣称为飞牛公开发布的独立组件包。API：https://semi.design/zh-CN/navigation/pagination 。
- 使用独立临时目录和 localhost:5180 的 23 条暂停脚本任务验证，未执行脚本、未连接 NAS。翻页、末页3条、搜索重置、状态筛选、10/20条切换、跳到第3页及刷新保留页码均通过。
- 小窗口测试：900×600 下6列的表头与单元格横坐标差均为0，换页前后分页栏位置保持固定（最终布局 y=536）；420×600 下无整页横向溢出，分页底部584且整页高度600。数据区内部允许横向滚动。临时浏览器 viewport 已恢复。
- npm run build 通过；现有18项测试通过。测试截图 docs/screenshots/task-table-official-layout.jpg。

## 0.2.3 NAS 安装更新与图标修复

- 修复 alpha 透明留白重复缩小；新增连续4次规范化不收缩测试，19项测试通过，构建及FPK打包通过。
- 新增卡片编辑、下载入口安装包、删除的 Semi Tooltip，支持鼠标悬浮和键盘焦点；授权弹窗的生成授权链接及完成连接按钮右对齐。
- 经用户明确授权，将此前本地工具栏、筛选、固定表格分页以及图标修复一起安装到 NAS。
- 更新前将旧版本重新打成可恢复 FPK，保存原始数据与已有快捷入口至 NAS /root/deskicons-update-v023-20261018/。通过官方 appcenter-cli 卸载/安装自身包，恢复数据后重启服务。未改动系统网页或恢复包。
- 实机 API 确认 version=0.2.3，原 LibreTV 条目保留，修复图标后 revision=4 并重新应用原桌面入口；1个计划任务记录保留。

## 0.2.4 弹窗与容器列表修复
- Docker 选择列表优先复用已保存图标，否则按容器标签和应用地址自动读取；最多并发 3 个，读取失败保留 Docker 默认图标。
- 图标编辑弹窗固定可用高度，错误提示预留 52px，列表和表单各自滚动，避免提示出现时弹窗重新居中。
- 官方授权的断开按钮右对齐，使用当前主题 danger 色及悬停/按下状态。
- 新建任务弹窗改为固定标题、固定操作区、内部内容滚动，内部输出与内容区统一细滚动条。
- 本地构建通过；19 项既有测试全部通过。浏览器在 900×700 窗口验证：弹窗 y=16、高668，底部操作区 y=611～683，内容区506px且内容628px，滚动只发生在内容区。
- NAS 已备份旧界面及入口至 `/root/deskicons-update-v024-20261018/`，覆盖本应用静态资源与版本入口后重启本应用服务；原生 Unix socket API 回报 version=0.2.4、native=true。

### 0.2.4 桌面入口恢复
- 用户反馈 NAS 工具箱图标消失，实查应用中心状态为 `start`，虽后台 Socket 可用，但不满足桌面显示所需的 `running` 状态。
- 使用官方 `appcenter-cli start deskicons` 完成状态同步，随后 `status deskicons` 返回 `running`。
- 刷新飞牛后浏览器 DOM 确认存在“NAS 工具箱 NAS 工具箱”桌面按钮和图像。后续部署必须通过应用中心启停并确认最终 running，不仅检查后台 HTTP。
- 说明：本次静态资源热更新的 API 版本为0.2.4，应用中心注册包仍为0.2.3；直接 install-fpk 不升级已存在同名包。未为修改显示版本再卸载重装。

## 0.2.5 日志选项与表单控件统一（2026-10-19）
- 日志级别显示普通、警告、错误、全部级别；模块使用官方 `logger modules --locale zh-CN` 返回的中文名称，自动加载并支持刷新，不再展示原始 JSON。
- 实机模块：-1 全部、0 系统、1 登录连接、2 文件传输、3 硬盘存储。实机只读 `logger list --level=-1 --module=-1` 成功；负数必须使用 CLI equals 形式，分开的 `--level -1` 被 CLI 拒绝。回归测试覆盖 -1 保留、空编号拒绝与调用参数。
- 新建/编辑任务的类型、程序、操作、频率、级别、模块，以及图标编辑的端口均使用同一 Semi Select；时间与单次日期分别使用 Semi TimePicker/DatePicker，保留原调度时区逻辑。
- 弹出面板挂载到原生 dialog 顶层、脱离内容滚动区，启用空间不足自动翻转。下拉宽度匹配输入框，内部列表236px+上下内边距8px，避免默认 inline 270px 撑出外框。统一6px细滚动条。
- 修复时间组件内层 input 被全局 focus outline 覆盖造成双边框；输入框仅外层显示焦点边框。复选/单选、数字输入外观、错误色、默认图标蓝色和其余滚动区域统一主题。
- 脚本文案改为“以 root 身份执行。脚本经标准输入传给 Bash，不写入命令行参数。”
- 本地构建及21项测试通过。浏览器900×700验证浅色/深色、时间03:00→04:00、单次日期2026-10-20T00:14正确回填；下拉列表宽度与触发框一致。可见原生 select 数量为0。
- NAS 通过官方应用中心重装0.2.5（保留应用数据），最终注册版本0.2.5、status=running，后台state版本一致；1个原任务和LibreTV入口保留，官方授权可继续读取模块。备份目录 `/root/deskicons-update-v025-20261019/`；实际数据副本为 `data-snapshot/`（var条目是原路径软链接）。
- 实机浏览器确认日志模块中文下拉，选择“全部”后实际表单值为-1。未保存清理任务、未执行真实日志清理。
- 当前 FPK SHA256：3c424512200614ec7a61863fb40fc6937f6734cc142f74f7b909cae05d8dca90。

## 0.2.6 执行记录抽屉与布局统一
- 日志入口使用 Semi SideSheet 从右侧打开，内部 Semi Table 展示时间、触发方式、结果、耗时、退出码、查看详情。详情区分标准输出和错误输出，支持复制和截断提示；异步请求有过期结果保护。
- 复用同一个 TaskPagination 组件和 native-pagination 样式，抽屉分页固定在底部，表格和详情独立滚动；ResizeObserver 根据实际剩余高度调整表格滚动区，避免双滚动条。
- 本地临时预览只执行12次无副作用的 printf，验证第一页10条、第二页2条；540×620验证抽屉边界、底部菜单及详情没有溢出。1000×700验证右侧抽屉x=192、右边距8、上下间距8。
- 移除操作列“调用”及其旧弹窗界面。原有后端只读预览接口仍保留。
- 小于等于620px时左侧菜单改为底部56px双入口导航，内容区为导航预留空间。主内容面板圆角12px，与窗口保持8px间距。
- 原生dialog增加遮罩点击关闭，起止点击都须在弹窗外才关闭，内部拖到外部不会误关闭；确认弹窗通过cancel事件处理取消。SideSheet使用maskClosable和closeOnEsc。
- 文本输入去除外扩粗outline并统一焦点边框。两菜单搜索框和筛选框共享固定宽度及响应式规则；540px视口两搜索框实测均344px。
- 构建和21项测试通过。NAS官方应用中心安装0.2.6并确认running；保留原应用数据，备份 `/root/deskicons-update-v026-20261019/data-after-stop/`。最后仅覆盖本应用dist以同步搜索框宽度修正，无系统web文件变更。
- 后续用户修正：侧板应贴齐右、上、下三边，仅主内容面板保留圆角与8px留白。最终1000×700验证侧板矩形(200,0,800,700)，无外边距。侧板分页移除跳至（实际quickjump节点0），计划任务分页保留（节点1）。
- 计划任务分页按用户后续要求也移除“跳至”；共享分页组件默认 showQuickJumper=false，保留总数、页码及每页条数。构建通过并同步NAS静态资源。
- 小屏幕底部菜单增加系统安全区适配：viewport-fit=cover，使用 env(safe-area-inset-bottom,0px) 增加导航底部padding及总高度，同时等量减少内容高度、增加内容底部预留。抽屉底部分页也增加安全区padding；横向使用safe-area-inset-left/right。无安全区时保持既有尺寸。构建通过并更新NAS静态资源；实际手势条尺寸由宿主浏览器报告，未声称已在实体手机验证。
- 两菜单来源/状态筛选与表单下拉统一使用 NativeSelect；复用同一个弹出面板、选中态及滚动样式。浏览器实测来源和状态均32px高、6px圆角、14px字体、1px主题边框；构建通过并同步NAS。
- 移动端按压反馈：关闭浏览器默认的矩形 tap highlight，保留主题 active 和键盘 focus-visible；菜单项、容器项、打开方式选项的反馈裁切到自身圆角内。构建与打包通过，NAS同步静态资源。
- 触屏刷新按钮状态：在 hover:none 或 pointer:coarse 环境下，非active状态强制恢复默认背景，避免触屏sticky hover；按压时仍显示主题active反馈，不调用blur，不移除键盘焦点提示。
- 小屏幕底部菜单选中状态仅将图标和文字变为主题蓝，背景保持透明一致；按压瞬间仍保留反馈。构建与打包通过并同步NAS。
- 按用户最终要求，小屏幕底部菜单取消按下瞬间的填充、阴影及滤镜，仅保留当前菜单图标/文字颜色区别；键盘focus-visible轮廓保留。构建打包通过并更新NAS静态资源。
- 窗口与浏览器标题只显示当前菜单“桌面图标”或“计划任务”，移除“ - NAS 工具箱”后缀，Web宿主仍通过官方sdk.setTitle同步。构建打包通过并更新NAS。
- 移动端添加图标：Docker 应用列表改为可搜索 NativeSelect，包含图标、容器名称、运行状态与端口，桌面端保留列表。加载、空列表、失败有明确提示；原名称/URL/图标联动复用chooseContainer。
- 隔离本地5182模拟两个容器验证540×700布局：选择Alpha后名称正确、URL为http://127.0.0.1:8080/，容器列表display:none，选择区高度97px。构建及21项测试通过。
- 移动端打开生成图标跳转登录问题调查：官方index.cgi文档明确校验NAS登录态，现有入口统一使用CGI转跳。在无登录态上下文实测LibreTV CGI返回200 text/plain正文invalid token。等待确认用户为飞牛App外部浏览器还是手机Web内点击；未在缺少证据时更改认证方式或将token放入URL。

## 0.2.7 飞牛手机App桌面图标登录跳转修复
- 用户确认在飞牛手机App内打开图标。此前所有入口都经过NAS CGI，匿名上下文实测返回invalid token；官方文档明确CGI验证NAS用户登录态。
- 对目标主机匹配本机网卡地址/主机名的Docker入口，改为官方protocol/port/url端口服务模型，保留type、路径、查询参数和片段；其他主机保持既有路由，避免误用NAS主机替换外部主机。
- 新增回归测试先复现CGI错误，再验证本地Docker端口入口及外部主机路由保留。22项测试通过，构建与打包通过。
- 实机确认192.168.1.35属于NAS网卡地址；不带NAS登录态访问18080返回200及LibreTV页面。此验证不等于实体手机测试，手机仍须能访问应用服务端口。
- NAS官方应用中心已安装0.2.7且running，原1个计划任务保留。已通过本应用API重新保存并应用原LibreTV入口，revision/appliedRevision均5，shortcut版本1.0.5且running。实查入口config为type=iframe（保留用户现有模式）、protocol=http、port=18080、url=/，不再含CGI路径。备份 `/root/deskicons-update-v027-20261019/`。手机实体App需由用户复测。
### 移动端卡片布局验证（2026-10-19）
- 参考用户提供的飞牛手机 App 截图，任务、执行记录与图标采用灰底白色圆角卡片，操作收纳到更多菜单；桌面端保留表格。
- 393×852验证任务卡片、记录详情、任务与图标编辑菜单，无横向溢出；1000×800恢复桌面表格。
- 22项测试、构建及打包通过。已更新NAS静态资源，应用状态running，HTML/JS/CSS哈希与本地一致；未执行真实NAS任务。
- 更新前资源备份：/root/deskicons-update-v027-20261019/dist-before-mobile-cards。实体手机显示需用户复看。


### 移动端顶部工具栏及连续列表（2026-10-19）
- 两菜单采用全宽搜索、40px操作按钮、直接点选的快捷筛选标签；桌面保留下拉菜单，两种控件共享筛选状态。
- 按用户补充，移动端计划任务及执行记录取消分页，连续显示全部筛选结果/已保留记录；桌面分页保持。
- 320px/393px窄屏无横向溢出，图标来源筛选和任务状态筛选有效；23个测试任务与12条执行记录均展示，移动端无分页；1000px桌面恢复下拉与10条分页。
- 构建及FPK打包成功；NAS静态资源已更新且哈希匹配，应用running。截图docs/screenshots/mobile-toolbar.png；旧资源备份/root/deskicons-update-v027-20261019/dist-before-mobile-toolbar。
### 移动端标题操作及下拉刷新（2026-10-19）
- 移动端顶部显示菜单标题，主要操作位于右侧；两页面与执行记录隐藏刷新按钮，改为列表顶部下拉刷新。桌面端保留刷新按钮。
- 手势限制单指、顶部、纵向及阈值，排除输入与嵌套滚动，刷新中禁止重复请求，提供下拉/松开/刷新中提示。
- 23项测试通过，构建打包通过；320px/393px布局无横向溢出，1000px保留桌面刷新。实体手机手势未实测。
- NAS静态资源已更新、哈希匹配，应用running。旧资源备份/root/deskicons-update-v027-20261019/dist-before-pull-refresh。截图docs/screenshots/mobile-title-actions.png。

### 移动端筛选行操作（2026-10-19）
- 按用户修正移除网页内移动标题行，新增按钮置于筛选行最右侧，仅显示加号；授权入口保留为链接图标，按钮保留aria-label与title。桌面文字和刷新保持。
- 320px/393px无横向溢出，任务与图标新增弹窗均能打开。构建打包通过，NAS资源哈希匹配且running；保留原下拉刷新。截图docs/screenshots/mobile-filter-actions.png。

### 移动端卡片等高（2026-10-19）
- 统一各列表内部卡片标题/信息槽位，标题最多两行，任务计划与记录摘要最多两行；不同功能卡片保留各自内容结构。
- 320px实测23张任务卡片均244px，图标卡片均224px；393px任务卡片仍244px，无横向溢出。构建打包通过，NAS静态样式哈希匹配，应用running。
- 截图docs/screenshots/mobile-equal-cards.png；旧资源备份/root/deskicons-update-v027-20261019/dist-before-equal-cards。

### 统一卡片几何、紧凑筛选及图标刷新（2026-10-19）
- 图标和任务卡片统一16px圆角/内边距、48px图标、16px标题、12px间距与更多按钮位置；按已确认设计，去除强制等高空白，内容决定高度。
- 未在官方公开文档中找到移动筛选标签尺寸。参考用户截图，将可见标签由40px缩至32px/6px圆角，保留40px透明触摸区域。
- 下拉刷新采用20px刷新SVG，随下拉转动，刷新中旋转，无可见文字；保留无障碍状态文字与减少动态效果支持。
- 23项测试、构建打包通过。393px实测图标/任务卡宽均361px、图标均48px；320px两页面无溢出。刷新手势实体手机仍需复看。
- NAS静态资源更新且HTML/JS/CSS哈希匹配，应用running。旧资源备份/root/deskicons-update-v027-20261019/dist-before-compact-ui，截图docs/screenshots/mobile-compact-filters.png。

### 移动端底部面板和按钮对齐（2026-10-19）
- 图标编辑/任务编辑采用贴底92dvh上限面板、顶部20px圆角、内部滚动与固定安全区底栏；授权使用自然高度底部面板。执行记录改为Semi bottom placement，桌面保持right。
- 简短确认弹窗保留。393px/320px验证面板贴底、保存区可见、遮罩可关闭；1000px恢复居中700px任务弹窗。
- 两菜单省略按钮统一距卡片上/右16px；新增/授权按钮与筛选标签同为32px可见高度并保留40px触摸区。刷新改为24px灰色圆环。
- 23项测试、构建及打包通过。NAS资源已更新且HTML/JS/CSS哈希匹配，应用running；旧资源备份/root/deskicons-update-v027-20261019/dist-before-bottom-sheets。
- 截图docs/screenshots/mobile-task-bottom-sheet.png、mobile-icon-bottom-sheet.png、mobile-history-bottom-sheet.png。实体手机手势和键盘体验需用户复看。

### 更多及新增按钮视觉一致性修正（2026-10-19）
- 原图标卡省略字符继承card-actions字号，与任务卡不同。改为共用MobileMoreButton SVG组件与40px容器，消除字体继承差异。
- 393px实测两菜单按钮top/right均16px，SVG top/right均26px；菜单及编辑弹窗均可打开。新增按钮与未选筛选标签底色/前景色一致，伪元素均上下4px，可见32px高/6px圆角。320px无溢出。
- 构建打包通过；NAS资源哈希匹配、应用running。备份/root/deskicons-update-v027-20261019/dist-before-button-alignment；截图docs/screenshots/mobile-aligned-buttons.png。

### 图标编辑精简与下拉刷新流畅度（2026-10-19）
- 移除图标编辑副标题、选择应用刷新按钮、内网提示、桌面预览及对应DOM引用。隔离5182模拟容器选择后名称/地址/自动图标正确，未保存测试数据。
- 下拉手势不再更新布局高度，改为transform移动列表与绝对定位指示器；松开/取消使用过渡，刷新反馈至少保留250ms，刷新期间忽略重复触摸。
- 23项测试通过，新增断言保证拖动不改高度且复位transform。构建打包通过。NAS资源哈希匹配，应用running；手机实际手势流畅度需复看。
- 截图docs/screenshots/mobile-simplified-icon-sheet.png；备份/root/deskicons-update-v027-20261019/dist-before-clean-editor。

### 图标面板顶部间距与滚动区修正（2026-10-19）
- 移动图标面板标题区由76px缩为56px，页签40px；面板按内容自然高度显示，上限92dvh，取消隐藏错误提示的52px占位。
- Docker选择区与表单共享editor-body滚动，form-panel不再独立滚动，底部操作固定。393×852实测618px面板内容无溢出；320×600仅内容区scrollHeight505/clientHeight399，底部操作y544–600可见，无横向溢出。
- 构建打包通过，NAS资源哈希匹配且running。截图docs/screenshots/mobile-compact-icon-sheet.png，旧资源备份/root/deskicons-update-v027-20261019/dist-before-editor-spacing。

### Docker下拉键盘自动弹出修正（2026-10-19）
- 组件原trigger搜索会在打开时强制focusInput。改为searchPosition=dropdown、autoFocus=false、preventScroll=true、motion=false，搜索框16px字体。
- 393px预览确认打开列表activeElement为DIV/combobox而非INPUT；手动输入Alpha过滤有效，选择后名称、URL、图标联动正确。实体手机键盘性能未实测。
- 构建打包通过，NAS资源哈希匹配且running，备份/root/deskicons-update-v027-20261019/dist-before-docker-focus；截图docs/screenshots/mobile-docker-search-no-autofocus.png。

### 下拉搜索样式与键盘重复卡顿处理（2026-10-19）
- 用户确认每次弹键盘均卡顿，尚缺实体手机性能证据。统一搜索边框/背景/圆角/焦点；移动输入实际16px，避免聚焦缩放，40px搜索高度。
- 禁用容器下拉autoAdjustOverflow以避免键盘时自动翻转，保留无自动聚焦、preventScroll与关闭动画；图标面板禁用滚动锚定和平滑滚动。
- 393×460预览搜索与选项仍可见、输入和选择有效；此模拟不代表真实键盘卡顿已消除。构建打包通过，NAS静态哈希匹配、running。
- 备份/root/deskicons-update-v027-20261019/dist-before-search-aligned，截图docs/screenshots/mobile-docker-search-aligned.png。

### 统一键盘视口适配及诊断（2026-10-19）
- 新增keyboard-viewport模块：visualViewport resize/scroll及focus事件通过requestAnimationFrame合并；统一输出面板max-height与bottom，仅补偿宿主尚未处理的部分，不主动blur/focus。缩放时不当作键盘。
- 本地内存保留最近100条视口尺寸/焦点标识，通过window.deskiconsViewportDiagnostics()读取；不记录输入值、地址或凭据，不上传。用于后续实体手机定位，不等同已获取手机证据。
- 新增测试覆盖视觉视口缩小、宿主已resize防重复、offsetTop、恢复、缩放及无API回退，24项测试通过。393×852→460→852预览焦点和Alpha文本保持、面板恢复、选择联动正常、无控制台错误。
- 构建打包通过；NAS资源哈希匹配，应用running。备份/root/deskicons-update-v027-20261019/dist-before-viewport-fix；截图docs/screenshots/mobile-keyboard-viewport.png。实体手机键盘动画流畅度仍需复测。

### 按用户要求移除网页键盘避让（2026-10-19）
- 删除keyboard-viewport模块、初始化、视口变量样式及对应测试；不再监听visualViewport/焦点调整面板，不保留诊断全局函数。保留搜索、无自动聚焦及现有移动样式。
- 23项测试、构建打包通过；NAS静态资源哈希匹配，应用running。飞牛App原生容器的键盘处理不属于网页可关闭范围。
- 备份/root/deskicons-update-v027-20261019/dist-before-no-keyboard-insets。

### 录屏确认普通输入也跳动：稳定编辑面板顶部（2026-10-19）
- 阅读用户7.959秒录屏逐帧：搜索与普通名称聚焦均伴随面板整体位置变化，不限于下拉菜单。推断自然高度贴底布局与宿主键盘resize共同触发重新定位；未把该推断视为已证明唯一原因。
- 仅移动图标编辑面板改为top16px/bottom0、表单100%高，中间内容滚动；不恢复JS键盘避让。牺牲自然高度以保持顶部位置稳定。
- 393×852→460预览两种输入均保持面板top16，焦点/文本保留，底栏bottom460，恢复852后选择正常；构建打包通过。
- NAS资源哈希匹配且running。备份/root/deskicons-update-v027-20261019/dist-before-stable-editor，截图docs/screenshots/mobile-stable-editor-top.png。实体录屏复测仍待用户确认。

### 桌面工具栏搜索收窄（2026-10-19）
- 用户暂停键盘问题，要求两个菜单搜索框减小宽度避免换行。覆盖1100px以下筛选区强制100%行宽规则；桌面搜索最大180px、可收缩，721px以上工具栏保持同排；较窄桌面筛选与按钮适度收紧，移动端保持。
- 1005px计划任务搜索/操作均top28；850px两菜单搜索宽180px、搜索/操作均top24，无横向溢出。构建及FPK打包通过。
- 已更新NAS静态资源并备份/root/deskicons-update-v027-20261019/dist-before-compact-toolbar。截图docs/screenshots/desktop-compact-toolbar.png。

### 桌面白色面板顶部贴边（2026-10-19）
- 桌面main移除8px顶部外边距，高度调整为100dvh减底部8px；保留内部20px工具栏留白。移动端不变。
- 1005×660实测main top0/bottom652，工具栏top20。构建打包通过，NAS样式哈希匹配且应用running。
- 截图docs/screenshots/desktop-panel-no-top-gap.png；备份/root/deskicons-update-v027-20261019/dist-before-no-top-gap。

### 移动编辑改为页面布局（2026-10-19）
- 按确认方案，图标、任务及授权编辑在移动打开时使用非模态show()与静态文档流，隐藏列表视图；页面独立滚动、操作按钮随页面滚动。关闭后恢复列表，桌面仍showModal()。不恢复键盘监听。
- Docker选择器改为details页面内展开，搜索/选项直接参与页面布局，无浮动portal及自动定位。保留名称/镜像搜索、图标及运行状态/端口展示。
- 24项测试通过，包含移动/桌面模式分流及异常清理。隔离5182验证Docker筛选、选择、保存后返回列表；任务表单取消返回、460px可视高度下文档滚动/输入保留；1005px桌面仍模态弹窗。未在NAS创建或执行测试任务。
- 构建打包成功，NAS HTML/JS/CSS哈希匹配且running。备份/root/deskicons-update-v027-20261019/dist-before-inline-forms；截图docs/screenshots/mobile-inline-icon-editor.png。真实飞牛App键盘流畅度仍须复测。

### 键盘时隐藏底部导航、移除侧栏品牌（2026-10-19）
- 移除侧栏NAS工具箱品牌及图标DOM。移动端仅在可编辑输入与键盘量级视口收缩时隐藏底部导航，恢复后重显；不移动面板、不调整焦点或键盘inset，不记录输入内容。
- 导航腾出区域供列表使用，搜索顶部不变。393×852→460→852预览nav none→flex，search top33、焦点和值保持；桌面侧栏菜单top16、无品牌。
- 新增测试排除桌面、缩放、小幅视口变化，并覆盖关闭恢复；25项测试、构建打包通过。NAS静态HTML/JS/CSS哈希匹配且running。
- 备份/root/deskicons-update-v027-20261019/dist-before-navigation-keyboard；截图docs/screenshots/sidebar-without-brand.png及mobile-navigation-hidden.png。实体键盘显隐仍需手机复看。

### 侧栏底部显示当前版本（2026-10-19）
- 将环境标记替换为/state接口返回的版本号，当前显示v0.2.7；保留状态圆点和主题按钮。本地预览提示仍按运行环境控制。
- 浏览器确认侧栏显示v0.2.7；构建及打包成功。NAS静态资源哈希与本地一致，应用running。
- 备份/root/deskicons-update-v027-20261019/dist-before-version-label；截图docs/screenshots/sidebar-version.png。
### SSH 终端 0.2.8：本地实现与安装准备（2026-10-19）
- 新增 SSH 终端菜单；统一三菜单导航与平台标题，连接列表、搜索筛选、新增/编辑、更多操作复用现有视觉；移动表单正常页面流、底部三菜单和辅助键。
- ssh2 经现有统一网关 WebSocket 连接本机/远程 SSH；仅管理员、有效网关 UID，连接/信任/会话按 UID 隔离。CSRF 创建一次性 30 秒票据，WS 首条认证绑定 Origin/UID，5 秒认证超时。
- 密码/私钥/口令不持久保存，主机指纹确认在提交凭据之前，变化需明确替换。每用户一个会话，断开级联释放；服务退出清理。网络发送与终端渲染消费 ACK 双重限制 1MiB 输出积压。
- 45 项测试全部通过，包含隔离真实 SSH 的密码/私钥/加密私钥、PTY、指纹变化、分阶段超时、HTTP/WS 权限、票据、坏消息、无 ACK 大量输出释放、配置持久化与导航；构建打包成功，生产依赖可导入。
- 独立复审修复认证参数遗漏、终端渲染背压、ssh2 总超时三个问题：浏览器复现认证失败后修复复测，新增测试 RED→GREEN；复审确认 12 项聚焦测试通过、无剩余阻断。
- 浏览器 1005×740/393×852 检查创建连接、远程字段、指纹、认证、输入、菜单切换保持、取消/重连、私钥字段切换与回归密码；实体手机 IME/键盘动画仍待实机验证。截图 ssh-terminal-desktop.png、ssh-terminal-mobile.png、ssh-connections-mobile.png。
- NAS 已备份真实数据和 target 到 /root/deskicons-update-v028-20261019/data-before、target-before。官方 CLI install-fpk 对已安装应用仅提示 installed，未升级；已转官方应用中心上传 0.2.8，当前停在责任声明确认，等待用户明确同意。尚未声称 NAS 安装完成。

### SSH 终端 0.2.8：NAS 正式更新与实测完成（2026-10-19）
- 用户明确同意官方应用中心责任声明后，点击同意完成手动升级。官方管理器显示 running，manifest 和页面显示 0.2.8；静态 HTML 与终端 transport.js 摘要和本地构建一致。
- NAS 网关实际传递的管理员/UID/Origin 可完成 HTTP 创建会话和 WebSocket upgrade；未放宽身份或来源校验。新建“本机 NAS”配置（本机回环、实际 SSH 端口、用户填写的登录账号），核对主机指纹与 NAS 独立读取的公钥一致后连接。
- 通过新终端仅执行 whoami、pwd，输出为 super、/home/super；切换计划任务再返回仍已连接。测试结束主动断开并返回列表，浏览器控制台无 error。
- 图标 entries.json 与更新前备份摘要一致，任务配置文件逐字节一致；现有 1 个图标、1 个任务保留。terminal 目录仅 1 条连接和 1 条主机信任，无 password/privateKey/passphrase/ticket 字段；测试凭据不保存。
- 发布后复跑完整测试 45/45 通过。备份保留 /root/deskicons-update-v028-20261019/{data-before,target-before}；截图 docs/screenshots/ssh-terminal-nas.png、ssh-connections-nas.png。真实公网远程目标未提供，远程能力在隔离 SSH 服务验证；实体手机 IME 和键盘动画仍需用户设备复测。

### 终端铺满应用、交替行与补充刷新（2026-10-19）
- 用户确认终端行灰白交替。终端视图 show/hide 切换 terminal-focused，显示时覆盖整个应用并隐藏侧栏/底栏，返回列表恢复导航与原面板布局；连接生命周期保持原样。移动终端保留辅助键和安全区。
- 使用当前 xterm 6 DOM renderer 的实际行元素交替底色（白色 #fff / 浅灰 #f4f5f7），深色为 #191919 / #242424；不启用额外透明渲染或读取私有 renderer API。当前稳定 CSS 结构需在未来升级 xterm 时复核。
- SSH 列表桌面新增“刷新”按钮，与其他菜单样式一致，移动仍使用现有下拉刷新。认证弹窗/连接协议未修改。
- 隔离 SSH 实测连接、刷新、返回后保留会话、深浅主题、断开；1005×740 与393×852时终端 bounds 均为整个视口、sidebar display:none；返回后导航恢复。DOM 实际行底色交替与行高一致。
- 45/45 测试及构建打包通过；NAS 静态资源更新，应用 running，本地/NAS HTML SHA256均0785bc3cbd1d1c19f87160c46f217ffc6f5585e0382e58fe8bd72a5cc5c5ec36。NAS 同样验证两种尺寸、条纹、刷新和返回导航；当前账号已有另一活动会话，未强制断开它，本轮连接行为以隔离 SSH 实测为准。
- NAS备份/root/deskicons-update-v028-20261019/dist-before-terminal-focus；本地备份/tmp/deskicons-before-terminal-focus-20261019.tar.gz。截图 ssh-terminal-full-desktop.png、ssh-terminal-full-mobile.png、ssh-refresh-nas.png。版本保持0.2.8。

### SSH 保存认证与自动连接（2026-10-19）
- 连接类型（NAS 本机/远程主机）与认证方式（密码/私钥）统一为单选卡片，复用图标打开方式的视觉；支持读取私钥文件、保存加密私钥口令。
- 凭据以 AES-256-GCM 加密，绑定所有者、连接、主机、端口、账号、认证方式；接口不返回密文或原始凭据。编辑空值仅保留同一目标和方式的认证，修改目标需要重新填写；主机信任完成后才取出认证信息。密钥丢失不覆盖生成新密钥，需恢复认证密钥备份。
- 新增 6 项测试覆盖加密持久化、权限和不回显、空值保留、目标变化、损坏与密钥丢失，以及真实隔离 SSH 的密码/私钥/加密私钥自动认证和重连；完整 51/51 通过。构建与打包成功，独立复审未发现阻断项。
- 浏览器桌面与390×844移动视口检查单选、远程字段和私钥字段，无横向溢出；移动真实键盘行为未在实体设备测试。
- NAS 已备份到 /root/deskicons-update-v028-20261019/saved-auth-before/{data,target}，通过官方管理器停止/启动更新后端及静态资源，状态 running，版本保持0.2.8。加密模块 SHA256 与本地一致。
- 已将用户提供的本机 NAS 登录凭据保存在原有连接中，实际点击即自动登录，无重复认证弹窗；whoami 返回 super。编辑不回显，留空保存后再次自动登录成功。验证后主动断开。
- NAS credential.key 与 connections.json 均0600；配置记录有 credentialBox 且没有原始 password/privateKey/passphrase/credentials 字段。entries.json 和 tasks.json 与备份逐字节一致。
- 截图：ssh-saved-auth-nas.png、ssh-saved-auth-nas-connected.png、ssh-saved-auth-mobile.png。安装包 build/deskicons/deskicons.fpk 已重新生成，不包含用户凭据或应用认证密钥。

### SSH 表单与导航样式修正（2026-10-19）
- 连接类型改回共享 NativeSelect 下拉，切换远程正确显示并校验主机地址；认证方式保留密码/私钥单选卡片。
- 保存认证与临时认证中的原生文件输入均隐藏，由统一按钮触发系统文件选择；私钥读取和原有大小限制保持。
- SSH 卡片“连接终端”右对齐，并覆盖继承的 margin-right:auto；NAS 实际 DOM 测量按钮右边与操作区右边间距为0。
- 从导航移除桌面图标、计划任务数量节点及更新逻辑；NAS页面导航仅显示菜单名。
- 完整51/51测试、构建打包通过。NAS仅同步dist，无需重启服务；更新前备份 dist-before-ssh-ui。HTML SHA256本地和NAS均101f3cd2854bc86cab32da6d20c0684bb339ff8c4d1081ac1985f1c016f4da52。
- 截图 ssh-select-upload-nas.png、ssh-right-connect-no-count.png；未修改已有连接凭据。

### SSH SFTP 文件面板 0.2.9（2026-10-19）
- 右侧贴边居中展开按钮，默认收起；展开后桌面终端与360px文件面板并排，移动393×852覆盖内容区域且没有横向溢出；终端连接不重建，灰白交替行与全屏导航行为保留。
- 支持目录路径/上一级/刷新、排序及文件计数；上传下载、新建目录、重命名与确认删除（非递归）。上传256MiB上限、原始二进制流、随机临时文件提交、重名拒绝；所有操作复用当前已信任SSH会话SFTP权限。
- SessionFiles句柄操作绑定实际SFTP通道，调用30秒超时、传输60秒无进展中止；最多一个写入和两个下载、10000目录条目。接口保持管理员/所有者/CSRF保护，闭会话和旧响应不能操作新目标。
- 66/66完整测试通过；含真实隔离SSH/SFTP、HTTP/WS归属与CSRF、字节内容比对、Unicode/HTML名称、链接、权限、空目录、取消、超限、超时、迟到初始化、CLOSE挂起和提交前取消。构建和打包成功。
- 独立复核发现传输OPEN/CLOSE挂起、未发open时漏清临时文件、下载取消句柄泄漏及提交前取消失效；已逐项修复并保留RED→GREEN回归。最终复测确认阻断解决。
- 本地浏览器实际验证新建/重命名/上传/下载，下载文件与上传原文件cmp一致。实体手机键盘未实测。
- NAS已通过官方appcenter-cli install-local完成更新，官方管理器running，manifest及界面0.2.9。更新前备份/root/deskicons-update-v029-20261019/{data-before,target-before,manifest-before}。entries.json、tasks.json、terminal/connections.json、terminal/credential.key与备份一致。
- 本地/NAS dist/index.html SHA256均4443001acf84a1eaf57f2d925438db2b1e0b2469f25d53e810ee31408ab21b8d，server/terminal/files.js均b4c5fc1b098c799c369c6bce70689fa21b70acedb9c3a5ef7f78f78d5ea504ae。
- NAS真实已保存密码自动连接成功，SFTP初始/home/super；专用新建目录中上传31字节文件、浏览器下载cmp一致、重命名成功，属主super、0600。确认内容与预期生成数据一致后清理测试文件及空目录，未修改用户既有文件。
- NAS深色主题、路径输入错误后恢复、返回连接列表再进入保持会话、移动393×852覆盖和收起均验证；测试后恢复原浅色主题并主动断开。截图terminal-files-nas-desktop.png、terminal-files-nas-mobile.png、terminal-files-nas-dark.png。

### 文件面板右键菜单、历史导航与目录大小（2026-10-19）
- 路径栏左侧为填充三角形后退/前进按钮，刷新移到输入框右侧。历史仅在成功导航后记录，刷新不重复追加，后退后新路径截断前进分支。
- 去掉操作列与独立上传/新建按钮。文件行右键提供下载、重命名、删除、上传、新建；列表空白处仅上传、新建，手机长按同一菜单。支持Escape/外部点击关闭及Shift+F10键盘菜单。
- 列顺序名称、类型、大小、修改时间，手机也保留类型。文件夹大小列显示计算图标，点击才递归扫描普通文件内容大小；跳过链接，最多10000条、64层、30秒，超限/权限错误不返回部分结果。
- 新增真实SFTP目录大小、超时释放、HTTP size归属/CSRF、历史导航和菜单上下文失效回归；完整71/71通过，构建与打包成功。浏览器已验证10字节目录计算、空白/文件菜单区别、菜单新建/上传及后退导航。
- 独立复核发现长按500ms期间换目录/会话可能借用新上下文；修复为session/path/请求代次快照，load/session改变时清理计时，菜单动作及文件选择后均重新验证。回归RED→GREEN，复核确认修复。
- NAS已备份到/root/deskicons-update-v029-20261019/context-menu-before/{data,target}，通过官方管理器停启同步server/dist，版本保持0.2.9，状态running。图标/任务文件与备份逐字节一致。
- NAS实测已保存凭据自动登录、.local目录手动计算0B、目录右键菜单及刷新位置；393×852视口四列均显示，panel393px/table373px，无横向溢出。长按生命周期通过代码复核及快照回归，未在实体手机实测触摸事件。
- 本地/NAS HTML SHA256均becf1f6e8a2142a12c0c3cf2c16bc3e33c7e32b320299965f0538955f9cebb67，files.js均1db77a73ba7493534f2fbb79d186cb30bdca44e4642ac8485d24efa4ab573cd8。截图terminal-files-context-nas.png、terminal-files-context-mobile.png；验证会话已主动断开。

### 双击目录请求冲突与可拖动分割线（2026-10-19）
- 用户报告目录持续busy；NAS服务日志三次出现“正在读取目录，请稍候”。原桌面onClick在双击时发送两次请求，后一个409和序列号使前一个成功结果被忽略，无法建立后退历史。隔离SFTP并发列表测试复现200/409。
- 改为桌面双击目录行/链接进入、手机轻点、键盘Enter；createDirectoryLoader合并同目标重复请求并串行导航，只发布最后目标，失败/无效会话不遗留加载状态。新增重复、排队、失败重试、session失效测试。
- 用户随后明确“先不处理前进后退，保持现状”，因此保持原历史导航和按钮判定逻辑，没有加入父路径回退或选择式前进。
- 移除可见“正在读取目录”状态行与文件管理标题/关闭按钮，仅保留边缘展开收起；仍保留aria-busy与错误提示。修改时间增加年，时间列124px。
- 桌面分割线支持Pointer Capture拖动和键盘左右调整，默认360px，最小240px，最大70%且保留终端至少240px；移动仍全宽覆盖。宽度变化复用终端ResizeObserver，无键盘高度避让监听。
- 77/77测试、构建及打包通过。慢速隔离SFTP每次READDIR延迟400ms，浏览器单击不进入、双击可进入、后退恢复可用；拖动实际测得面板360→520px，日期显示2026/10/19。

### SSH 工作区 NAS 更新（2026-10-19）
- 检查其他窗口完成的资产目录、快捷指令、多连接标签实现；完整测试已运行96/96通过，构建成功，独立只读代码复核无确认的P1/P2问题。
- 用户要求停止后续测试并先更新NAS，因此未继续浏览器功能测试；未声称多标签和移动界面已完成实机验证。
- NAS更新前备份server、dist及应用数据到/root/deskicons-update-v029-20261019/workspace-before；经官方管理器停止后同步server/dist，再启动。版本保持0.2.9。
- 更新归档SHA256：3977c08abd4f77843e7d7eadb4f13f17908c628b237e111519d0f317c7b8c52e。本地/NAS HTML：4ff0649d1ca647e8e956699d6d6f88203c6bc8eeddc232ac1ad77cecd19515ae；terminal/routes.js：ed72eeabf93a88bfc704f9e7ce20d2a314869b2aae064f3e74b869383fc5388b。
- 更新后官方status为running；entries.json、tasks.json、terminal/connections.json及terminal/credential.key与本次备份逐字节一致。后续功能测试按用户要求暂缓。

### SSH 多标签工作区与树形分类（2026-10-19）
- 目录/快捷指令按用户和 assets/commands 隔离，目录最大16层，指令最大16KiB、每用户合计1000条。workspace.json 0600，和连接配置共用串行事务，目录删除与连接归属修改不会产生悬空引用。
- 每用户最多8个、全局32个SSH会话；编辑/删除检查全部会话，创建会话与连接写入串行协调。旧连接默认根级，目录调整不改变目标绑定加密凭据。
- 独立标签拥有终端、输出、代次、文件面板和观察器；重复打开激活原标签，关闭当前选择相邻标签，最后关闭显示空态。认证和指纹确认排队，关闭实例取消其请求；指令不追加Enter，CR/LF发送前确认并复核代次，拒绝其他控制字符。
- 本地真实SSH双连接验证输出隔离、切换保留 /folder 和文件面板展开、关闭A后B仍可输入；单行指令以原文发送。模型/HTTP测试覆盖迟到创建释放、队列取消、所有会话编辑保护、限额、凭据兼容和并发归属。
- 独立审查发现并修复3项Important：资产节点覆盖连接类型、单标签关闭清除全局退出保护、连接创建与编辑/删除的竞态。三项均补充回归，RED→GREEN；最终96/96测试通过，构建与打包成功。构建仍有既有大chunk提示。
- 根据用户反馈修正全局button居中继承：资产/指令树标签justify-content:flex-start，目录箭头、类型图标、名称分列，层级缩进20px并绘制连接线。NAS实测资产及指令标签计算样式均为flex-start；已有“测试”“ces”目录保留。
- 截图 terminal-workspace-desktop.png、terminal-workspace-mobile.png（393×852本地响应式）及 terminal-workspace-tree-nas.png（NAS实际树形界面）。移动长按存在轻微手指移动就取消、空白区只能更多/右键的次要体验限制；实体手机键盘未实测。
- NAS原有活跃终端最初阻止更新；用户随后明确授权“你结束会话然后更新”及“直接更新到nas吧”。通过官方管理器stop/start更新server/dist，结束旧终端，最终running、版本保持0.2.9。
- 更新前完整备份 /root/deskicons-update-v029-20261019/workspace-tree-before-CYyYLZ/{target,data,manifest}。entries.json、tasks.json、terminal/connections.json、terminal/credential.key更新后与备份cmp一致。既有workspace.json也未覆盖，NAS自动登录验证成功，验证后关闭标签释放会话。
- 本地/NAS dist/index.html SHA256均b1bbc3bf62972cf4015b18dfe2399ae3a80a11809666a5352a06f1f673fd313e；workspace-store.js均7aa6179e07d7818670d210f3fed48d096da715e869cfe0e7d963cb98e9264ffa。
- 本地原始源码备份 .superpowers/terminal-workspace/source-before.tar.gz；非Git工作区按计划保留备份和验证日志，未初始化Git。安装包 build/deskicons/deskicons.fpk 不含NAS用户数据。

### 全屏终端灰色导航栏（2026-10-19）
- 图标栏底色使用主题灰色fill-0，宽度与顶部标签栏高度共用 --terminal-bar-size:46px；移动端同步统一46px，分类底部面板左侧偏移跟随同一变量。
- NAS实测railWidth=46、tabHeight=46，底色rgba(14,14,15,0.04)。构建成功，仅同步dist，无需重启或中断其他会话，应用running；验证连接已关闭。
- 备份 /root/deskicons-update-v029-20261019/rail-style-before-9Gi8f5/dist；截图terminal-workspace-gray-rail-nas.png。HTML SHA256 99445128f8ed3084a025d3ee2817d78c07c02dd2c3b4098c054bded9c0b97f1e。

- 用户要求顶部标签栏不改：移除标签栏/分类标题与侧栏的共享尺寸变量，逐条对比确认所有顶部tab样式与修改前完全相同，仅侧栏灰底/46px宽度保留。NAS已同步，running，备份rail-style-before-SLbC0O。

### 按原生标题栏校准侧栏（2026-10-19）
- 实测飞牛原生窗口 .trim-ui__app-layout--header 高44px（而非终端连接标签栏46px），主菜单.sidebar底色rgb(242,243,244)。
- 仅终端图标栏改44px宽、直接使用var(--sidebar)，桌面与移动偏移一致；顶部连接标签所有CSS规则与原始备份逐条一致，保持46px。
- NAS实测railWidth44、railColor和mainSidebarColor均rgb(242,243,244)，tabHeight仍46。仅同步dist，未重启应用或中断原有会话；验证连接已关闭。备份rail-style-before-OVHBpG/dist。截图terminal-workspace-native-gray-44.png。

### 终端内容区统一主卡片样式（2026-10-19）
- 右侧工作区沿用工具箱主内容面板：8px外边距、12px圆角、主题内容底色；外层复用主菜单灰色，资产树展开时也有一致的圆角面板。移动圆角10px。
- NAS实测外底rgb(242,243,244)，内容卡片白色、margin8px、radius12px；侧栏44px及连接标签46px保持。构建通过，静态同步后running，未重启；验证会话已释放。
- 备份rail-style-before-SHi2xG/dist；截图terminal-workspace-content-card.png。
- 移除终端图标栏右侧分割线：NAS实测borderRightWidth=0px、宽度仍44px；构建通过、仅静态同步，running，备份rail-style-before-JPZmXF。截图terminal-workspace-no-sidebar-divider.png，验证会话已关闭。

### 文件面板拖到边缘收起（2026-10-19）
- 移除240px最小宽度；宽度可缩至边缘，距右侧12px内吸附收起，保留原有最大宽度与终端预留空间。收起后清理Pointer Capture及拖拽光标，再展开恢复此次拖动前的宽度，目录/历史不丢失。键盘Home和持续ArrowRight也可收起，aria-valuemin改0。
- 新边界测试RED→GREEN，完整97/97通过，构建成功。NAS实际Pointer拖动360→120px→右边缘收起，再展开120px且/home/super不变；Home也能收起。截图terminal-files-drag-edge-collapsed.png。
- NAS仅更新dist，无重启，running；备份rail-style-before-ofnkJ8/dist，验证会话已释放。

### 文件列表四列整体缩放（2026-10-19）
- 类型/大小/修改时间原先固定像素，仅名称列吸收面板宽度变化。四列改为36%/12%/17%/35%，标题和内容统一溢出省略，不再仅压缩名称。
- NAS实际拖动面板360→180px，四列宽129.23/43.08/61.02/125.66→64.44/21.48/30.43/62.66，均同步减半；继续拖到右边缘正常收起。截图terminal-files-proportional-resize.png，验证会话已关闭。
- 构建成功，仅静态更新、应用running，备份rail-style-before-EBtvlI/dist，未重启或修改用户数据。

### 主菜单顶部对齐系统设置（2026-10-19）
- 按用户指定当前打开的fnOS系统设置窗口实测，设备信息菜单项高36px，内容区顶部间距8px，来自flex容器pt-2。工具箱原为16px，现仅桌面.sidebar padding-top改8px；手机底栏保持。
- NAS实测首个“桌面图标”距顶部8px、菜单高36px，与系统设置一致。属于fnOS1.2.0800原生实测参考，非官方公开强制规范。构建通过，仅静态同步，running；备份rail-style-before-8VPRX0/dist，截图sidebar-top-match-settings.png。

### 终端图标栏顶部间距与提示（2026-10-19）
- 返回按钮顶部间距从4px改8px，与主导航及系统设置一致。返回连接列表/资产列表/快捷指令均加入具名role=tooltip及aria-describedby，鼠标悬浮和键盘focus-visible可显示，避免与原生title重复。
- NAS实测首按钮距顶部8px，三个提示文本完整，键盘聚焦快捷指令提示visibility:visible/opacity:1，截图terminal-rail-tooltip.png。构建成功、仅静态更新、running，备份rail-style-before-UDYZjm；验证连接已关闭。

### 主菜单左右留白统一（2026-10-19）
- 原侧栏右padding8px叠加内容卡片左margin8px，菜单项到卡片16px而左侧8px。去除卡片额外左margin，桌面卡片从180px起、中等窗口从160px起；右边及顶部外留白保持8px。
- NAS测量leftGap8/rightGap8/topGap8/cardRightGap8，构建通过，静态更新后running。备份rail-style-before-HJQ6tz/dist，截图sidebar-equal-horizontal-gaps.png。

### 终端分类菜单选中态及间距（2026-10-19）
- 资产/快捷指令增加selected及aria-pressed，与面板当前scope/展开状态同步，分类切换仅一项选中，重复点击或面板关闭按钮取消选中。选中复用主菜单bg-1及primary，浅色实测rgba(255,255,255,.5)/rgb(0,102,255)。
- 保持图标栏44px，按钮高36px，顶部8px、左右8px，项间距5px，与主菜单一致；按钮宽28px，分类面板及主卡片移除叠加的左外边距。
- 新选中状态测试RED→GREEN、全套98/98、构建成功。NAS实测top8/left8/right8/height36/gap5，切换和收起状态正确。截图terminal-rail-selected-spacing.png；仅静态同步，running，备份rail-style-before-oSstQv/dist，验证连接关闭。

### 终端卡片顶部与主页面一致（2026-10-19）
- 主页面桌面main已有margin-top0，终端卡片及资产面板额外margin-top8造成错位。仅桌面两面板margin-top改0，保留其他间距及移动样式。
- NAS实测mainTop0/assetsTop0，与主页面一致。构建成功，仅静态更新、running；备份rail-style-before-VJbC65/dist，截图terminal-workspace-top-aligned.png，验证连接关闭。

### 目录与快捷指令表单复用（2026-10-19）
- 原目录/指令编辑独立创建原生select、使用包裹字段的label，未接入已有共享控件。现在接入createTaskFormControls→NativeSelect、flat label[for]及公共输入样式，弹窗复用openEditorSurface。动态弹窗关闭dispose共享控件React根节点。
- 共享下拉增加显式data-allow-empty，目录可从子目录选回根目录，连接所属目录同样启用；其他空值placeholder保持原义。
- 98/98测试通过、构建成功。NAS实际新建指令、目录编辑：inputHeight32/selectHeight32、输入border rgba(14,14,15,.16)/radius6px、原生select隐藏且label关联完整，ces→根目录可往返，重复取消后控制台无错误。仅查看/取消未改用户配置，验证连接关闭。
- 静态同步后running，备份rail-style-before-haOJQR/dist；截图workspace-shared-form-controls.png。

- 分类与终端卡片间距修复：仅桌面分类可见时相邻terminal-workspace-main增加margin-left8px，避免此前统一菜单留白时两卡片贴合。NAS实测cardGap8/menuGap8，分类收起后collapsedGap仍8；构建通过，静态同步running，备份rail-style-before-wR55AS，截图terminal-assets-card-gap.png，验证连接关闭。

### 目录树拖拽与公共聚焦（2026-10-19）
- 资产、指令、目录可拖入同分类目录；空白处移回根目录，目录移动包含后代，拒绝自身、后代及跨分类目标。桌面使用HTML拖拽，触屏使用抓手。触屏目标需处于可见范围，未实现边缘自动滚动。
- 连接folder接口只修改folderId和更新时间，共用原子事务，保留凭据并支持活跃连接；workspace的parent-only更新在事务内合并最新字段。编辑不发送归属，避免覆盖其他窗口的拖拽结果。
- 移除菜单“编辑 / 移动”中的移动文字，以及目录、指令、连接编辑中的归属下拉；新建按操作目录归属，编辑保留原归属。
- 公共聚焦规则不再只枚举旧表单ID；按表单结构统一覆盖名称和textarea。NAS实测两者border均为rgb(0,102,255)，outline和shadow均none。截图workspace-shared-focus.png。
- 新模型/API测试RED→GREEN，全套101/101，构建与打包成功。独立tree_drag_review未发现核心Important问题；触屏长树无边缘滚动记录为限制。
- 本地真实SSH夹具实测活跃连接拖入目录、整棵目录移动、循环拒绝、移回根目录、指令拖入目录及新建归属level2；菜单仅编辑，编辑无目录select。截图terminal-tree-drag-local.png。未执行快捷指令。
- NAS完整备份/root/deskicons-update-v029-20261019/workspace-tree-before-KHvOeY后官方stop/start更新server/dist，最终running。entries、tasks、connections、credential.key、workspace.json与备份cmp一致，旧认证自动登录成功，验证后关闭会话。

### 关闭终端标签二次确认（2026-10-19）
- 标签关闭按钮复用公共确认弹窗和队列；取消保持连接与输出，确认只关闭对应标签。重复点击合并请求，迟到确认核对原标签对象，不能关闭同连接重新打开的新标签。
- 新回归RED→GREEN，全套103/103，构建成功。NAS验证取消后标签仍在，确认后显示无连接空态。截图terminal-tab-close-confirm.png。静态同步无需重启，running，备份rail-style-before-7fUTIf/dist。

### 2026-10-19 SSH 主机系统监控

- 新增快捷指令下方的监控入口、菜单 CPU/内存/磁盘摘要和详情卡片；每 3 秒跟随当前 SSH 标签刷新，旧请求响应不会覆盖新主机。
- 独立 SSH exec 通道读取 Linux 系统数据，服务端每会话去重、2 秒缓存、5 秒超时、256 KiB 输出限制；关闭会话释放采集通道。接口校验管理员及会话归属，不返回认证信息。
- `npm test`：110/110；`npm run build` 通过。测试覆盖 CPU 差值、内存、ZFS、本地磁盘及虚拟挂载过滤、超大输出、断开清理、标签切换晚到响应及真实 SSH/HTTP 归属和交互 shell 隔离。
- Chrome 本地 fixture 验证菜单选中、详情卡片、分类互斥、双标签切换；真实 NAS 验证保存的凭据自动认证及实际 CPU/内存/磁盘数据。
- NAS 更新前完整备份：`/root/deskicons-update-v029-20261019/workspace-tree-before-C7am6u`。部署后比较 entries/tasks/connections/credential.key/workspace 原始文件。
- 真实 NAS 最终显示 CPU 动态使用率、内存约 37%、本地磁盘汇总约 78%，明细为 `/`、`/boot/efi`、`/vol1`。截图：`docs/screenshots/terminal-system-monitor.png`。关闭验证标签后摘要归零为“—”。安装包已重新生成，临时部署认证文件已清理。

### 2026-10-19 参考服务器面板扩展监控详情

- 按用户确认保留左侧位置，扩为 300px 卡片面板，增加主机信息、负载、Swap、资源/网络趋势、每核 CPU、前 5 个只读进程、网卡速率/累计流量/IP 与磁盘；标题关闭按钮保持稳定，自动刷新保留滚动位置。
- 趋势按实际时间保留最近 180 秒、最多 60 点；每个 SSH 会话独立历史，旧主机响应不覆盖当前标签。网速按计数差值计算，计数回退显示待采样；默认路由网卡用于网络趋势，避免 bridge/veth 重复汇总。
- 新增解析/速率/每核/历史隔离/过期测试，完整 `npm test`：114/114；`npm run build` 通过。独立代码审查无阻断问题，审查提及的时间窗和网络重复统计已修正。
- 更新前备份 `/root/deskicons-update-v029-20261019/workspace-tree-before-5tn6ij`。
- NAS 部署后服务 running，entries/tasks/connections/credential.key/workspace 与备份逐字节一致。Chrome 实测保存凭据自动登录为 super、4 核实时采样、默认路由速率、4 条趋势曲线、进程/网卡/磁盘明细；采集子进程从进程榜中排除。截图 `docs/screenshots/terminal-system-monitor-details.png`，安装包重建成功，临时认证文件已删除。

### 2026-10-19 文件管理右键上传文件夹

- 新增“上传文件夹”菜单及独立目录选择器，上传前校验完整路径、文件大小、重复文件/目录冲突及总条目/深度；先创建目录再串行上传，根目录重名只提示改名，不覆盖或合并。
- 复用文件接口、进度和取消按钮；失败保留已完成内容并明确提示。刷新完成后再次校验会话及 controller，避免旧连接清除新上传进度。
- `npm test` 120/120、`npm run build` 通过。真实 SFTP 嵌套文件和重名保护测试通过。内置浏览器完整验证目录选择、中文层级上传、同名改名后独立上传，根文件/嵌套文件字节一致。Chrome 扩展自动选择受文件 URL 权限限制，使用内置浏览器完成验证，未修改浏览器权限。
- 已静态部署至 NAS，服务 running，无需重启。备份 `/root/deskicons-update-v029-20261019/rail-style-before-I3Rwtn/dist`。
- NAS 页面右键空白区域实测显示“上传文件 / 上传文件夹 / 新建文件夹”；截图 `docs/screenshots/terminal-upload-folder-menu.png`。安装包已重新生成，部署临时凭据已清理。

### 2026-10-19 文件压缩/解压和可视化权限

- 右键文件/目录增加压缩、修改权限；压缩包增加解压缩。ZIP/tar.gz 使用目标 SSH 的独立 Python 3 通道，输出名称校验、同名保护、写操作互斥、响应与时间限制。解压到新目录，不用系统 extract 解包接口，拒绝路径穿越、符号/硬链接、特殊文件、重复/冲突路径，异常清理新输出。
- 源目录使用固定目录描述符逐级 O_NOFOLLOW 遍历，权限通过固定文件描述符修改；修复审查发现的并发链接替换问题，并用可重现的压缩目录替换测试验证修复。
- 可视化所有者/用户组/其他人读写执行矩阵与 3/4 位八进制同步，读取当前 UID/GID，保留特殊位，复用公共 checkbox/input/select/editor surface，仅修改当前选中项。
- `npm test` 127/127；`npm run build` 通过。真实 SSH/SFTP/HTTP 测试覆盖归属/CSRF、压缩解压、权限、路径注入、越界包、大小限制和链接；浏览器验证公共压缩格式下拉、权限矩阵保存为 0640、tar.gz 往返文件字节一致。
- NAS Python 3.11.2 实测压缩/解压往返与 Linux O_PATH 固定句柄权限修改通过。更新前完整备份 `/root/deskicons-update-v029-20261019/workspace-tree-before-DBF5mr`。
- 效果截图：`docs/screenshots/terminal-file-permissions.png`、`docs/screenshots/terminal-file-compress.png`。

在线编辑候选参考：CodeMirror 6（MIT，https://github.com/codemirror/dev）和 FileGator（https://github.com/filegator/filegator）。File Browser（https://github.com/filebrowser/filebrowser）当前已归档，仅参考交互，不作为新依赖；复制路径已于后续更新实现；用户明确暂不实施在线编辑，未引入编辑器依赖。
- 最终 NAS 服务 running，配置/连接/认证密钥逐字节保留。公共弹窗宽度规则排除 checkbox/radio，实测权限矩阵为公共 16×16 勾选框；NAS 真实权限弹窗展示 0755 并取消，未修改用户原有权限。截图 `docs/screenshots/terminal-file-permissions-nas.png`。安装包已重建，临时部署凭据已清理。

### 2026-10-19 文件管理复制路径

- 空白区域复制当前远端目录，文件/目录/链接条目复制完整绝对路径；保留原字符与空格，不做 Shell 转义。沿用菜单会话/目录/请求序号校验，过期菜单不执行。
- 提取公共 clipboard 模块供路径及任务日志复用，现代 Clipboard API 失败后可回退 HTTP 复制方式。
- `npm test` 128/128，`npm run build` 通过；内置浏览器实际复制并粘贴验证 `/marker.txt` 和 `/`。NAS HTTP 实测两种菜单均提示成功，自动化 Chrome 的独立虚拟剪贴板限制未用于声称原生粘贴验证。
- NAS 仅更新前端，服务 running，未重启；安装包重建，临时认证文件清理。截图 `docs/screenshots/terminal-copy-path-menu.png`。在线编辑用户要求暂不做，未安装 CodeMirror。

### 2026-10-19 左侧实时上传/下载摘要

- 在 CPU/内存/磁盘下增加上传、下载速率；复用同一采样和公共 networkRates 汇总，优先默认路由接口，避免重复流量。格式化数字/单位分行以适配 44px 菜单，断线及首次采样显示“—”。
- `npm test` 129/129、`npm run build` 通过，新增汇总/单位/零值/未采样测试，保留切换主机迟到响应隔离测试。
- 前端静态更新到 NAS，不重启服务，安装包同步重建。
- NAS 实际连接显示上传/下载 KB/s 动态数值，关闭标签后均恢复“—”；截图 `docs/screenshots/terminal-rail-network.png`。服务 running，静态备份 `/root/deskicons-update-v029-20261019/rail-style-before-buAv8u`，安装包完成，临时凭据清理。

### 2026-10-19 移动端卡片间距与文件菜单外部点击

- 将 SSH 列表纳入原有移动工具栏公共规则，393px NAS 实测桌面图标、计划任务、SSH 列表首卡到工具栏均为 16px。截图 `docs/screenshots/mobile-terminal-gap-16.png`。
- 长按打开菜单后列表 touch pointerdown 会 stopPropagation，原 document 冒泡监听未收到外部触摸。提取文件菜单关闭绑定并改用 pointerdown 捕获，监听清理使用相同 capture 标志；菜单内部不提前关闭，Escape 保持生效。
- 实际浏览器事件传播回归页（`.superpowers/terminal-workspace/file-menu-dismiss.html`）在阻止冒泡的列表区域复现旧逻辑菜单仍显示；修复后外部点按关闭、内部操作执行、Escape 关闭。NAS 393px 同一菜单验证空白区域关闭和复制路径正常；独立手机物理触摸未连接，本轮通过阻止冒泡的真实 DOM 事件验证触摸拦截路径。
- `npm test` 129/129、`npm run build` 通过。NAS 前端静态更新、服务 running，不重启 SSH；包重建成功。截图 `docs/screenshots/mobile-file-menu-before-dismiss.png`、`docs/screenshots/mobile-file-menu-dismissed.png`。

- 移动端 SSH 卡片操作区：移除重复的底部 16px 内边距，复用公共卡片布局；NAS 393px 视口实测与桌面图标卡片操作行均为 55px、卡片底部内边距均为 0px。构建和安装包生成通过，已静态更新 NAS。

- 移动端三个菜单的更多按钮直接复用公共组件样式：NAS 393px 视口实测桌面图标、计划任务、SSH 卡片按钮均为 40×40px，三点 SVG 均为 20×20px。构建、打包通过，已更新 NAS。

- 桌面 SSH 卡片隐藏顶部更多菜单，连接操作靠左，右侧编辑/删除复用 CardAction（含悬浮提示）；NAS 实测桌面布局与编辑弹窗正常，小屏保留更多菜单。桌面图标操作顺序为下载、编辑、删除。构建及打包通过，已更新 NAS。

- SSH 类型筛选纳入公共 NativeSelect 样式，NAS 实测与图标来源选择框文字同为 14px、rgb(14,14,15)。更新到桌面按钮已移除加号 SVG，实测仅保留文字。构建和打包通过，已更新 NAS。

- 桌面图标与 SSH 卡片统一 48px 图标、列表 flex 滚动区、stable 滚动条占位及细滚动条样式。NAS 同视口切换实测两者卡片均为 316.7109375×179px，坐标均为 (204,68)。构建、打包通过，静态更新 NAS。

- 导航选中态统一 400 字重，避免 SSH 拉丁字符因 400→500 字重切换产生宽度变化；NAS 实测选中前后文本宽度均 60.4453125px、x 坐标均 42px。构建及打包通过，已更新 NAS。

### 存储工具：空间分析与重复文件首版（2026-10-19）
- 新增一级菜单“存储工具”，提供空间分析、重复文件扫描、目录选择、进度/取消、结果搜索和最近20次扫描记录；扫描仅只读，暂不提供删除、移动或批量重命名。
- 使用共用NativeSelect筛选、工具栏/search、task-table、TaskPagination、dialog/editor-surface、移动任务卡片和下拉刷新。四菜单移动导航，无横向溢出（393px视口及scrollWidth均393px）；移动不显示分页，每次加载50条。
- 后台worker_threads扫描，单用户1任务、全局2任务；10万条目/64层/10分钟、20GiB哈希读取上限，SHA256完整内容匹配，硬链接去重、跳过符号链接和跨挂载。结果限制2000个根级条目/1000组，重复路径全局最多2000个、每组200个，截断明确提示。
- 独立复核发现目录替换与同设备bind挂载可能越界；新增root替换回归观察RED后修复。Linux从根目录开始逐级O_DIRECTORY|O_NOFOLLOW打开，后续路径绑定/proc/self/fd目录句柄，校验mnt_id并跳过mountinfo挂载点；目录inode去重。最终复核无确认P1/P2遗留。
- NAS仅在/tmp/deskicons-storage-linux-check运行隔离夹具测试，5/5通过，未扫描用户存储目录、未修改已安装应用。覆盖空间汇总、重复内容、符号链接、硬链接、取消、上限、替换根目录。
- 本地浏览器验证3文件44B空间汇总，2个13B相同文件被归为1组，校验26B且额外副本13B；历史结果恢复时筛选一致。截图storage-tools-desktop.png及storage-tools-mobile.png。
- 大小均为文件逻辑大小，不表示磁盘实际占用、可释放空间或快照占用；记录仅保留在当前服务内存。本轮不更新NAS应用。
- 最终完整测试136/136通过，构建与原生FPK打包成功（build/deskicons/deskicons.fpk）；版本保持0.2.9。构建仅有既有的大chunk体积提示。

### 存储工具 NAS 更新（2026-10-19）
- 用户明确要求更新后，备份server/dist及解引用复制的实际应用数据到/root/deskicons-update-v029-20261019/storage-before；官方管理器停止应用，同步server/dist，重新启动后状态running。
- 归档SHA256：1a3be6e87bee380414fb07d61aa42405d3b347932ce01b8ab0ca84a2051c139e；本地/NAS HTML均31f1849b0b3c7d6c108b161aaaca8586f0e2c719c8c27fff6fd2a500ea2a422f。
- 统一网关Unix socket下已登录管理员的/storage/directories返回HTTP200；未启动实际用户目录扫描。entries.json、tasks.json、terminal/connections.json及terminal/credential.key与备份逐字节一致。版本保持0.2.9。

### 官方目录选择器与空扫描修复（2026-10-19）
- 核对已安装公开SDK @trimjs/web-app 0.5.0 README和类型：pickFile支持directory:true，pickUserFile额外带授权。此前自建选择器遗漏了公开能力，现优先复用平台SDK调用pickFile({directory:true,multiple:false})；宿主缺失/初始化不可用才使用本应用兼容浏览器，取消不误弹第二个选择器。
- NAS实际历史记录显示/vol01/1000多次扫描0文件、skippedLinks=2；其music/videos是链接到/vol1/1000真实目录。/vol02扫描0文件且skippedMounts=3，属于远程挂载路由树。原root枚举误将vol00/vol01/vol02与本地vol1并列是空扫描原因。
- 本地存储根只列vol[1-9][0-9]*；官方返回的vol01/vol02别名仅在规范化后目标位于本地真实根内时接受，并继续以实际路径的逐级不跟随链接句柄扫描。远程挂载明确报不支持。
- 区分“未发现内容相同文件”“搜索无匹配”“无可统计文件/已跳过”空态，保留搜索仅筛选已扫描结果的含义。
- 139/139完整测试通过，构建及打包成功。新增官方picker参数/取消/standalone与volume过滤回归；现有路径替换边界测试仍通过。
- 更新前备份/root/deskicons-update-v029-20261019/storage-picker-before，官方管理器停启同步server/dist。归档SHA256 6804ab43381b1754bd46b62b61c5eb27ba825bcc861d192b6ac23b5b3f7e5e38；本地HTML 8c9a25457191ff06d32807758483d2e92c10a285f873caba49ac61a7550faaee。
- 更新后官方status为running。NAS实测/storage/directories只返回/vol1；/storage/resolve把/vol01/1000/music解析为/vol1/1000/music。对该真实目录只读空间扫描completed，43文件、1447748316字节、43行结果、error:null，不再为空。未读取文件内容哈希或修改用户文件。

### 扫描记录样式统一（2026-10-19）
- 将自建dialog按钮列表替换为Semi SideSheet/Table，复用计划任务history-sheet、状态标签、TaskPagination与移动history-record-card。桌面右侧贴边、固定底部分页且无跳至；移动底部92dvh面板、无分页、支持下拉刷新。
- 扫描时间含年份及中国标准时区；目录省略显示并保留title；状态、文件数、明确查看结果操作分列。恢复结果同步类型/目录，不重新扫描；关闭/重开/旧响应使用生命周期代次校验。
- 本地12记录夹具验证翻页10→2条、查看重复扫描恢复1组结果、点击遮罩关闭。393×852移动视口sheet从top68到bottom852、left0，document.scrollWidth393，无可见分页。截图storage-history-desktop.png、storage-history-mobile.png。
- 139/139测试通过，构建和FPK打包成功。本次仅同步dist，无需重启后端，不会清空扫描记录。
- NAS dist更新前备份/root/deskicons-update-v029-20261019/dist-before-storage-history；本地/NAS HTML SHA256均fa117f38f8101cc8887154c2015baa4aad0b75e3088ef66c5c2af0c416fc5c28，官方状态running。
- 按用户要求移除存储工具主界面底部逻辑大小/记录保留说明小字。构建成功，仅更新NAS dist不重启；HTML SHA256本地/NAS均7687449d345b544b838adb486133b2c5277a769c2ad65e94e910fc197112eddb。备份dist-before-storage-note，状态running。

### 文件整理：批量改名（2026-10-19）
- 存储工具增加文件整理，复用目录选择、工具栏、任务表格、分页、历史侧板及移动卡片/编辑面板。支持文字替换、前后缀、序号和保留扩展名，预览过期5分钟，一次最多500普通文件；不递归改名、拒绝符号链接及同批硬链接别名。
- 修改前检查文件身份/大小/纳秒时间、目录身份和名称冲突。继承固定目录句柄传给Python，使用Linux renameat2 RENAME_NOREPLACE / macOS renameatx_np RENAME_EXCL，不覆盖既有目标。执行前持久化日志；中断记录可检查撤销，部分撤销支持重试。关闭服务等待在途操作并阻止关闭后启动新工作进程。
- 记录按账号隔离、全局CSRF保护，0600持久化。记录最多200条、每用户界面展示最近20条；撤销依赖文件仍符合校验和原名称未被占用。不是跨文件事务，部分执行会如实保留记录。需要Python3及支持排他改名的本地文件系统。
- 147/147本地测试通过；NAS独立临时目录8/8改名测试通过。覆盖冲突、源变化、跨账号访问、CSRF、硬链接、部分撤销重试、关闭等待和重启恢复；未改动用户数据文件。构建及FPK打包成功。
- 浏览器临时样例：预览2文件→执行→撤销，内容保持一致；393×852移动端无横向溢出，两张卡片均361×78，移动端无分页。截图storage-rename-desktop.png、storage-rename-mobile.png。
- 更新前备份 /root/deskicons-update-v029-20261019/batch-rename-before（server、dist、实际数据），官方管理器停止应用后同步server/dist并启动，状态running。新/storage/rename/records通过网关响应200，初始0条；entries.json、tasks.json、terminal/connections.json、terminal/credential.key与备份逐字节一致。
- 最终HTML本地/NAS SHA256均0c1c3d3242c86b2090d82b3165c1bd72e66caff59ba08ffa573f679b3eab42ec；最后仅同步dist补齐历史记录目录联动，无需再次重启。版本仍0.2.9。预览包build/deskicons/deskicons.fpk已重新生成。

### 存储工具全覆盖工作区（2026-10-19）
- 进入存储工具后覆盖应用内容区并隐藏主侧边/底部导航，返回按钮恢复此前菜单。桌面左侧空间分析/重复文件/文件整理，手机顶部切换；支持方向键、Home/End切换功能。
- 目录选择、搜索、记录和扫描操作合并为顶部工具栏；改名规则使用桌面右侧380px贴边面板，手机复用现有编辑面板。只在选择文件后显示生成预览，有有效预览后显示执行按钮。表格/卡片、分页、历史和后台接口继续复用。
- 修正存储CSS导入顺序以正确覆盖共用组件的局部尺寸，规则表单单列间距统一，改名列表纳入下拉刷新滚动容器。
- 147/147测试通过，构建和原生包重新生成。浏览器验证两文件预览、右面板left=1276/right=1656/top=0/bottom=1174，宽380；393×852手机workspace覆盖0–852、文档宽393无横向溢出、主导航隐藏，返回恢复桌面图标导航。
- 截图storage-workspace-desktop.png、storage-workspace-mobile.png。NAS仅同步dist，无需重启，备份dist-before-storage-workspace；官方状态running，本地/NAS HTML SHA256一致：8721d717c64f56bc6b06d06602ced26cfe119e2e997080b19d166f855fd83477。

### 记录独立菜单（2026-10-19）
- 扫描记录、改名记录移至工作区左侧，顶部记录按钮移除。记录复用已有Semi表格/卡片/分页，在主内容区直接展示，不再弹出抽屉；查看结果切回对应功能，改名结果同步目录。
- 手机功能栏可横向滚动，保留五个入口，记录继续无分页卡片展示；切换菜单或离开工作区停止记录轮询并使旧请求失效。
- 12条扫描样例在独立菜单正常展示，改名记录空态、功能选中与393px无横向溢出验证通过。147/147测试通过，构建及打包成功。
- NAS仅同步dist，备份dist-before-records-menu，无需重启，状态running；HTML SHA256本地/NAS均b9cb8893c3d3694cb87aabc3d75a037bcc9d6a891186204a2483779dfe078410。截图storage-records-menu.png。

### 记录搜索与目录入口精简（2026-10-19）
- 移除空间分析/重复文件/文件整理顶部搜索框，将搜索放入扫描记录和改名记录，按时间、目录、类型、状态及错误文字筛选；数量、分页和移动卡片同步筛选，输入后返回第一页。
- 移除独立选择目录按钮，点击只读目录框直接触发原官方目录选择器，支持Enter/空格和聚焦样式，扫描中禁用。
- 浏览器验证12条扫描输入“重复文件”筛出6条，输入无匹配词显示0条及空态；点击目录框和Enter均打开选择器。147/147测试、构建、FPK打包通过。
- NAS仅更新dist，备份dist-before-records-search，运行状态running。HTML本地/NAS SHA256一致ae0117ab7547b59142c1e0d9797a02700ecdcfe14edb481cd64e49843064c908。截图storage-records-search.png。

### 目录框宽度对齐（2026-10-19）
- 目录框对齐其他菜单输入框：桌面220px，1100px以下180px，手机220px并允许缩小；高度32px。右侧操作使用margin-left:auto。
- 浏览器测量桌面目录宽220、刷新右缘1252与工具栏右缘1252一致；393px手机目录220，文档宽393无溢出。构建、打包成功。截图storage-directory-width.png。
- NAS只更新dist，备份dist-before-directory-width，状态running。本地/NAS HTML SHA256一致942cebb0cd0b6cdd6d49c3553351a0c835ea35a6159662a03877fba2bb8f633d。

### 批量管理弹窗（2026-10-19）
- 文件整理工具栏增加批量管理，位于刷新左侧，选中文件后启用。主页面移除规则、生成预览、执行改名按钮，弹窗内完成命名方式选择、规则填写、原/新名称预览与确认执行。
- 增加统一命名：基础名称_序号，保留扩展名可选；原规则改名继续支持文字替换、前后缀和序号。编辑任何字段清空旧预览，冲突/无变更禁止执行，操作期间阻止重复提交及关闭。
- 149/149本地测试、构建和FPK打包通过。NAS独立临时目录10/10测试通过。浏览器临时样例验证两种模式、预览失效、执行和撤销；393px无横向溢出，截图storage-batch-manager.png。
- 原生更新前备份batch-manager-before（server/dist/解引用数据），官方停启后状态running，原图标/任务/连接/密钥逐字节一致，新改名记录API正常。HTML本地/NAS SHA256均5a63eeef861c965812901c12ff228996c3048c60be40b3501387fb29f1f567f2。

### 基于需求的存储扫描流程与图标栏
- 空间分析与内容查重采用首页选择目录、进度/取消、结果总结、详情流程。查看详情后显示功能图标栏；文件整理可直接进入，不要求先扫描。
- 总结提供文件数、逻辑大小、目录占用排行、索引数或重复组数及扫描时存储空间容量。区分容量统计范围，不统计快照独占空间和回收站占用。
- 文件详情支持目录/全部文件/大文件、最小MiB、90天/一年未修改、名称/大小/修改时间排序；索引上限10000条/2MiB元数据，最大文件清单1000条，截断明确提示。
- 查重组需显式选择保留副本与候选副本，保留项不能被列为候选；可导出CSV清单（转义引号和公式前缀）或打开所在目录，不执行删除或隔离。
- 扫描记录以0600文件原子持久化，目录0700。账号隔离、每用户20条、全局200条、总量32MiB，重启后运行中记录标中断。原三条内存扫描记录导出迁移，旧记录不补造文件索引。
- 独立审查修复三个P2：容量await前预留并发槽；记录保存期间取消后不创建worker；旧取消响应校验epoch/mode/id。回归先RED后GREEN，复核未发现新增实质问题。
- 158/158本地测试，NAS独立临时目录15/15测试通过，构建和FPK打包成功。浏览器临时样例扫描3文件44B，索引包含嵌套副本；1MiB筛选为空；查重1组2副本，选择保留后显式勾选一个候选才启用导出。
- 左栏对齐SSH的44px、28×36按钮，仅图标，hover/focus-visible名称标签，保留aria-label/description及方向键切换。393px手机宽度无横向溢出。截图storage-scan-summary.png、storage-scan-mobile.png、storage-icon-rail.png。
- 更新前备份storage-flow-before的server/dist/实际数据，并单独保存memory-scans.json。
- 官方管理器停止、同步server/dist、迁移三条记录并启动后状态running。原entries.json、tasks.json、terminal/connections.json、terminal/credential.key与备份逐字节一致。扫描API及持久化文件均3条，文件权限0600，其他owner返回0条。HTML本地/NAS SHA256一致bc1ccd1f614797f5b989e9ea0617f177191a74e031ca2978443c85b87f508b97。

### 存储工具双卡片入口（2026-10-20）
- 点击主导航“存储工具”保留应用主导航，显示空间分析、重复检查两张卡片。
- 自动读取每类最近一次扫描及其摘要；查看结果恢复总结页，重新扫描进入目录选择，不自动执行。
- 工作区返回按钮回到双卡片入口；文件整理、扫描记录、改名记录保留独立入口。
- 浏览器确认桌面双列、390px 移动端单列及主导航恢复，已有结果正确恢复。
- npm test：158/158；构建及原生打包通过。NAS 前端更新，状态 running，入口文件 SHA256 与本地一致。
- 截图：screenshots/storage-entry.png、screenshots/storage-entry-mobile.png。

### 扫描原位展示（2026-10-20）
- 新版入口顶部直接显示目录选择、扫描状态与文件数，不再跳转旧居中扫描页。
- 查看结果直接进入列表，列表返回及分析菜单返回新版入口。
- 存储入口和结果滚动区域复用 native-ui.css 公共 shared-scrollbar 样式。
- 浏览器验证扫描开始、轮询完成和结果查看；158 项测试通过，NAS 前端已更新并核对文件摘要，应用 running。

### 结果菜单跳转修复（2026-10-20）
- 工作区空间分析、重复文件菜单直接加载最近已完成结果，无结果时回新版入口。
- 保留请求序号及菜单检查，避免切换过程旧响应覆盖当前菜单。
- 浏览器验证文件整理 -> 重复文件，直接显示重复文件对照，无扫描入口跳转。
- 构建通过；NAS 前端更新，文件摘要一致，应用 running。

### 卡片选择目录直接扫描及空记录（2026-10-20）
- 移除扫描入口顶部目录框、开始按钮；卡片开始/重新扫描选择目录后直接执行，取消不启动。
- 官方目录选择器及内置目录选择器共用选定后执行逻辑。
- 重复文件菜单无记录时显示空表格“暂无重复检查记录”，无扫描失败提示、不跳转入口。
- 浏览器验证卡片选目录后进入重复检查中，以及独立无记录环境下的空表格。
- 构建通过；NAS 前端已更新，摘要一致且 running。

### 历史记录批量删除与间距（2026-10-20）
- 扫描记录、改名记录共用顶部“批量管理”；进入后支持多选、当前页全选和确认删除，移动端支持逐条勾选。
- 仅删除记录；删除改名记录前说明撤销入口会移除。正在执行的记录禁止删除。
- 服务端先校验整批归属与状态，再删除并写盘，保存失败恢复内存记录。
- 标题行顶部留白16px，标题行到下方内容16px；扫描入口四周及卡片间距16px。
- 160/160测试通过，浏览器确认批量选择控件和统一布局。

### 默认记录选择列与文字间距修正（2026-10-20）
- 扫描记录、改名记录默认显示多选列，勾选后启用顶部批量管理，直接显示删除确认，不再切换管理模式。
- 浏览器测得原标题文字顶部/底部到表格均20px，来自32px工具栏内24px标题居中额外4px；调整容器padding和工具栏margin各12px后，实际上下均16px。
- 浏览器确认默认11个复选框（当前页10行+全选）、勾选后批量管理启用。构建通过，NAS静态文件摘要一致且running。

### 记录表格复用文件整理样式（2026-10-20）
- 扫描记录和改名记录改用 task-table storage-table 公共表格，移除 Semi Table 内部布局及日志侧板表格padding继承。
- 公共选择列40px、选择框16px、行高48px，工具栏同文件整理44px；分页同时使用 task-pagination native-pagination。
- 浏览器实际确认记录行高48px、滚动容器padding0、分页公共class，构建通过并更新NAS。

### 重复文件批量移动与删除（2026-10-20）
- 移除查重说明行及CSV导出，顶部批量管理在指定保留文件、勾选副本后启用。
- 弹窗提供移动/删除单选、目标目录选择、保留与待处理清单；删除需勾选确认。
- 仅允许本账号扫描结果内的副本，执行前重新校验普通文件及完整SHA-256；保留路径不能作为处理目标，禁止符号链接及其他挂载越界。
- 同名目标不覆盖；先暂存并核对文件身份，失败恢复原路径；跨存储空间移动按复制校验后删除源副本处理。
- 处理结果写入扫描记录，已处理路径不再列为候选。每批100个、内容校验20GiB、进程120秒、并发2个且每账号1个。
- 本地163/163测试通过；NAS独立临时目录3/3操作测试通过（保留文件、同名冲突、内容变化、账号隔离）。浏览器确认选中后启用批量管理及目标目录回填。

### 重复组表格与路径侧板（2026-10-20）
- 主表改为选择列、文件名、重复数量，一行一组；点击行/名称显示右侧路径侧板，移动端底部面板。
- 按用户追加要求移除侧板打开目录按钮及跳转功能，仅展示路径；主页面移除已选择副本提示。
- 勾选重复组后启用批量管理，弹窗为每组明确选择保留文件，其他副本执行移动或删除。
- 浏览器确认三列、行点击、默认禁用批量管理、勾选启用、保留选择、侧板无打开目录按钮；构建通过，NAS文件摘要一致且running。

### 自动整理、单选控件与稳定弹窗（2026-10-20）
- 修正公共task-form-body通用输入框选择器：排除radio，避免16px单选框被width100%和min-height32px覆盖。
- 批量移动/删除默认自动整理，按路径字典序为每组保留一份，显示保留路径预览；支持切换手动选择。
- 弹窗固定高度、内容滚动并预留滚动条与操作区域，移除错误提示显隐导致的尺寸变化。
- 主表增加文件类型列；移动端卡片同步显示类型。
- 浏览器实测单选框16x16；切换移动/删除前后弹窗x260/y16/w760/h688完全一致，确认四列表头及自动保留预览。
- 构建通过，NAS前端文件摘要一致，应用running。

### 分组列表选择与处理方式下拉（2026-10-20）
- 调研 dupeGuru Results（https://dupeguru.voltaicideas.net/help/en/results.html）及 Czkawka FAQ（https://github.com/qarmin/czkawka/blob/master/instructions/FAQ.md），采用单栏分组、保留参考文件及批量规则的交互。
- 取消左右选择布局；每组折叠标题展示名称与数量，展开直接对比文件名、完整路径及保留/待处理状态，整行可选。
- 处理方式使用项目公共下拉控件；移除删除说明及额外勾选项，仅由确认删除按钮提交。
- 自动整理继续应用所有已选组；点选文件会切换手动保留，保留一份的后端校验保持有效。
- 浏览器确认下拉选择、单栏列表、16px单选框、删除按钮启用且无额外确认框；构建通过，NAS文件摘要一致并running。

### 2026-10-20 文件整理子目录
- 修复目录列表过滤全部子目录导致无法查看嵌套文件的问题；文件夹优先显示，点击名称或双击行进入，支持返回授权根目录内的上一级。
- 文件夹不参与选择和批量改名，不跟随符号链接。
- 新增嵌套目录读取、父目录边界、符号链接过滤和子目录文件改名测试；全部 164 项测试通过，生产构建和打包成功。
- 浏览器验证：根目录显示“文档”文件夹，进入后显示“副本.txt”，上一级按钮可用。

### 2026-10-20 文件整理前进后退
- 导航按钮沿用 SSH 文件面板的左右三角图标；导航历史以所选目录为起点，禁止跨出该目录。
- 进入新分支清除前进记录，读取失败不提交历史；导航读取期间禁用按钮。
- 浏览器验证进入子目录、后退至起点禁用、前进返回子目录；构建和打包通过。

### 2026-10-20 存储管理与网络唤醒
- 菜单更名为“存储管理”，其后新增“网络唤醒”，同步浏览器及飞牛 App 标题。
- 保存、编辑、搜索、删除设备，标准 UDP Magic Packet 发送、最近发送时间和账号隔离。广播目标仅接受私网 IPv4 或全局广播；限制连续发送和并发发送数量。
- 复用 createConnectionCards 的卡片与操作菜单、terminal-dialog、task-form-body、task-toolbar、connection-cards 公共布局和下拉刷新；没有新增样式表。
- 169 项测试全部通过，包含实际环回 UDP 收包、Magic Packet 内容、持久化、权限、CSRF、限流和导航。初次全量运行的一项既有扫描并发时序测试失败，定向复查及后续全量运行均通过。
- 浏览器验证新增保存、编辑回填、桌面卡片、390px 手机导航和更多菜单、底部编辑面板。未以“发送成功”推断实体设备已唤醒。
- NAS 已备份并部署：服务 running，前后端文件哈希与本地一致；/wake/devices 返回空设备列表。NAS 本机环回 UDP 实测收到正确的 102 字节 Magic Packet，没有向实际设备发送唤醒请求。

### 2026-10-20 批量唤醒
- 批量管理支持设备多选、当前筛选结果全选及一次最多 50 台设备发送。公共设备卡片添加可选的选择框能力，SSH 默认行为保持不变。
- 后端先检查整批所有权，再去重并发送；单台失败不打断其他设备，返回逐台结果。发送成功更新各设备最近发送时间，失败设备继续选中以便重试。
- 170 项测试通过，包含混入其他账号设备时整批拒绝、去重、部分失败、限流及状态保存；生产构建和打包通过。
- 本地浏览器以两台测试设备及模拟发送器验证批量管理、全选、结果表格和选择清理，没有触发实际设备开机。

### 2026-10-20 批量管理弹窗与 SSH 电源控制
- 移除页面内批量选择栏，改为公共 storage-batch-dialog 弹窗，复用处理方式下拉框、选择表格、公共按钮、滚动条及移动端表单容器。弹窗支持唤醒、关机、重启及逐台结果。
- 新增设备关联远程 SSH 连接和系统类型，复用已有加密密码/私钥与已确认主机密钥；固定平台电源命令，不自动信任新指纹，不使用强制关机参数。
- 单台/批量电源操作明确确认目标，支持配置变化校验、部分失败、限流、超时及断开结果未知提示。
- SSH 测试服务验证密码、私钥、主机指纹拒绝及非零退出码；API 验证管理员、账号归属、确认与批量执行；浏览器使用模拟电源执行器检查目标确认、取消、结果表格及手机编辑表单。没有对 NAS 或真实设备执行关机/重启。
- 最终全量 174 项测试通过，新增超时后迟到的 SSH ready 事件不能再执行命令、关闭服务后拒绝新电源操作，以及确认目标变化的拒绝校验。

### 2026-10-20 SSH 终端联动与公共批量管理按钮
- 设备下拉框展示当前账号 SSH 终端连接：未配置认证的远程连接可见并提示待配置；本机连接明确标记且禁用。
- 可从设备弹窗新建或配置远程 SSH 连接，保存后自动返回并关联，取消后保留设备草稿；复用原有 SSH 编辑器与加密凭据存储。
- 修复手机编辑器切换时前一个弹窗的 close 事件清除后一个表单布局状态的问题，共用移动端表单容器保持正确。
- 存储管理、网络唤醒的批量管理按钮共用 toolbar-manage，图标、32px 桌面高度、14px 字体、6px 圆角及图文间距一致。
- 176 项测试通过，浏览器验证新建/保存自动关联、配置取消保留草稿、设备保存以及手机双向切换；构建和打包通过。NAS 前端已备份并更新，哈希一致，服务 running。

### 2026-10-20 网络唤醒仅绑定 SSH
- 按用户要求移除网络唤醒中的新建、配置 SSH 按钮和跨菜单编辑事件逻辑，只保留绑定已有连接。
- SSH 连接的新增、修改、认证统一在 SSH 终端管理；待认证连接与本机连接仍显示状态，但不可绑定用于远程电源控制。
- 176 项测试通过，构建及打包通过；浏览器确认按钮已移除、已有连接可选及系统类型正常显示。NAS 前端已备份更新，文件哈希一致，服务 running。

## 网络设备计划任务（2026-10-20）

- 全套 Node 测试 182 项通过，生产构建及 FPK 打包成功。
- 覆盖账号隔离、最新设备配置、单台失败继续、设备删除、SSH 目标变化拒绝执行、超时中断和执行结果持久化。
- 本地界面验证设备多选、关机目标确认、暂停保存以及逐台执行记录，使用模拟发送器与电源执行器，未对真实设备发送关机或重启命令。

## NAS 管家 0.2.10 品牌与存储入口（2026-10-20）

- 内置 image_gen 生成应用、扫描、空间分析、重复检查四张透明 PNG，原图及缩小版本位于 web/assets/brand，提示词记录在 docs/design/NAS管家图标说明.md。
- 应用中心名称、桌面入口、网页默认标题改为 NAS 管家；通过官方应用中心由 0.2.9 升级为 0.2.10，用户确认本次责任声明后执行。
- 182 项测试通过，生产构建与 FPK 打包通过；NAS manifest 和服务版本均为 0.2.10，状态 running；64/256px 应用图标哈希与本地一致。
- entries.json、tasks.json、terminal/connections.json、terminal/credential.key、terminal/workspace.json、wake-devices.json 与升级前备份逐字节一致。备份：/root/deskicons-update-v0210-20261020/{target-snapshot,data-snapshot}。
- 存储移动端使用纵向卡片、居中插图和按钮，下方长卡片入口；390px 视觉检查、360px 无横向溢出，生成图片均加载成功。
- 扫描时使用 1.8 秒 CSS 光带，不旋转图片；非运行状态没有动画类，支持 prefers-reduced-motion。扫描详情进度和首页共用动画。
- 最终 NAS HTML SHA256：220e4e9f77f1ae38123c67d0d0d4d952b521dde791237c5daa5268bf21d012ea。

## 共用移动底部面板与网络唤醒筛选（2026-10-20）

- openEditorSurface 恢复原生 modal，保留背景与遮罩；共用面板圆角 20px，最大 88svh，表单内部滚动，底部操作区固定。移除整页表单覆盖规则，不添加键盘高度监听。
- 390×844 验证新增图标顶部约 162px、新建任务顶部约 101px，任务底部按钮位于视口底部；设备编辑面板顶部约 240px。关闭后背景状态恢复。
- 网络唤醒复用 mountTaskStatus：全部、已关联 SSH、仅唤醒；与搜索联合筛选。360px 同排显示，320px 通过共用筛选组横向滚动避免按钮重叠，标签组右缘 212px、操作按钮左缘 220px。
- 182 项测试通过；其中 editor-surface 原整页行为断言随新需求更新。一次完整测试遇到原存储并发时序测试失败，单独重跑及后续完整测试通过，未改存储实现。
- 生产构建及 FPK 打包完成，NAS 静态资源与本地 HTML SHA256 一致：ac61ff8611cafe9e6a8305b96ae3d2f9621dd4fe50508cb66809322570f5591a。

### 2026-10-20 空间分析扫描记录管理

- 空间分析顶部增加共用图标＋文字批量管理入口，桌面居中弹窗、手机底部面板。
- 复用扫描记录组件，按 space 类型过滤，支持多选/全选；扫描中记录不可删除。
- 继续调用已有 /storage/scans/delete，仅删除记录；删除当前记录后刷新结果，未选记录与实际文件保持不变。
- 修正隐藏的文件整理列表在屏幕尺寸变化时误改共用批量按钮的禁用状态。
- 浏览器验证桌面选择、确认后取消、手机底部面板；新增回归测试验证删除空间分析记录后原文件和重复检查记录仍保留。NAS 验证不删除用户数据。

### 2026-10-20 SQLite 迁移 / 0.2.11

192 项测试通过；新增 6 项迁移测试覆盖全部旧数据类型、幂等与旧文件不再导入、损坏源文件阻断、SQL 中途失败回滚、SSH 旧密文解密。更新原有文件断言为 SQLite；多 SSH 集成测试改为同时接受“提示信任”或“已使用同账号已保存主机密钥连接”，不再依赖两个连接的异步信任时序。

NAS 数据副本比对和正式迁移均成功，五菜单接口与页面已核对，数据库完整性正常。官方 CLI 的升级异常与恢复过程、备份位置详见 sqlite-storage.md。
