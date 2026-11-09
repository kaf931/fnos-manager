# AI 聊天附件

2026-10-22，随当前 0.2.52 运行包提供，数据库 schema 升至 9。

## 使用和范围

SSH 工作区 AI 输入框左侧的回形针选择附件，也支持拖入文件、粘贴剪贴板图片。待发送附件显示名称、大小和移除按钮；可只发送附件，不必填写文字。请求未被接受时保留草稿；切换 SSH、新建或恢复对话会清空未发送草稿。隐藏 AI 面板不清空草稿。

每条消息最多 4 个附件，总原始大小最多 4 MiB：

- UTF-8 文本、Markdown、日志、配置和代码，每个最多 256 KiB。
- PNG、JPEG、WebP 静态图片，每个最多 2 MiB、最多 2000 万像素。后端验证真实图片格式，拒绝伪装图片与动画。
- 暂不解析 PDF、Word、压缩包或其他二进制文件。

附件由用户明确选择后随消息发送到所选供应商，后续对话保留其上下文；不会自动读取 NAS 文件、终端历史或 SSH 凭据。附件内容作为分析数据，不作为执行命令的授权。审核与静默执行权限沿用当前聊天设置。

## 存储

**原文件不放入 SQLite。** 原文件写入 `$DATA_DIR/ai/attachments/<UUID>`，目录权限 0700、文件 0600。浏览器提供的名称不参与存储路径。文件写入、同步并原子发布后才提交元数据；失败回滚新文件，崩溃遗留的无引用文件在启动或下次保存时清理。

SQLite `ai_chat_attachments` 只记录所属账号、对话、消息、协议位置、显示名称、类型、大小、随机文件标识和 SHA-256。表使用 STRICT、CHECK、消息与协议外键及级联删除。消息接口只返回摘要，不返回文件内容或存储路径。恢复历史时在服务端校验大小及 SHA-256，再读取文件供模型上下文使用。

对话历史仍按账号保留最近 50 个会话并保护活动绑定，旧历史删除后清理无引用附件。卸载时选择保留数据会连同附件保留；选择删除应用数据才一起清理。schema 8 → 9 仅增表及索引，不改写现有业务记录。

## 供应商适配

| 协议 | 图片格式 |
| --- | --- |
| OpenAI 兼容、GLM、MiMo、MiniMax | `content` 中 `image_url`，data URI |
| Claude | `image` 内容块、base64 source |
| Gemini | `inlineData`，含 mimeType 和 base64 data |
| Ollama | 用户消息 `images` 原始 base64 数组 |

文本附件转为有明确起止标记的文本上下文。图片需要实际选择支持视觉输入的模型；当前 DeepSeek 协议和 MiniMax M2 系列会在发送前明确拒绝图片，不会悄悄丢弃图片。兼容接口的个别模型是否接受视觉输入由供应商决定。

官方格式参考：[OpenAI](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Claude](https://platform.claude.com/docs/en/api/http/messages)、[Gemini](https://ai.google.dev/gemini-api/docs/image-understanding)、[Ollama](https://docs.ollama.com/capabilities/vision)、[MiMo](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/image-understanding)。

## 验证

409 项测试全部通过，另通过 ESLint、Prettier、前后端类型检查及 FPK 构建。附件专项覆盖格式和大小拒绝、协议序列化、文件权限、重定向拒绝、校验损坏、历史恢复、级联和清理、SQL 失败回滚，以及保存失败后重试不泄漏旧附件。UI 测试覆盖选择、移除、拖入、粘贴、附件单独发送、失败保留和异步读取跨 SSH 隔离。

浏览器预览确认消息附件摘要及工具栏布局；Chrome 扩展未启用文件 URL 权限，文件选择器自动填入未完成，未修改用户扩展权限。文件选择行为由组件测试验证。未向真实付费模型发送测试附件。

NAS 部署验收：SSH 替换运行文件，保留数据，运行/登记仍 0.2.52；schema 8 → 9，26 表，旧业务表行数保持，数据库完整性 ok、外键错误 0，11 个关键接口均 200。NAS 隔离临时数据库验证了实际 Linux 文件写入、PNG 验证、文本与图片恢复，文件 0600、正式附件目录 0700；隔离测试已清理，正式聊天不插入测试内容。

## HTTP 兼容及存储管理清理（schema 10）

2026-10-22：修复 NAS HTTP 页面粘贴/选择附件报 `crypto.randomUUID is not a function`。该浏览器接口只在安全上下文可用（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)）；附件草稿改用页面内递增 ID，真正持久化 UUID 仍由后端 `node:crypto` 生成。未放宽浏览器安全设置。在实际局域网 HTTP 预览中确认 `isSecureContext=false`、`crypto.randomUUID=undefined` 时，文本附件仍正常读取。

存储管理首页新增「应用附件」长卡片，显示当前账号附件数量和总大小。管理弹窗复用公共编辑面板、筛选下拉、表格、移动卡片、分页和确认弹窗样式，无新增专属 CSS。支持名称/会话搜索、文本/图片筛选、7/30/90 天前筛选、当前页全选与批量清理，以及清理无引用文件。移动端使用卡片和加载更多，不展示分页控件。

清理附件仅删除本应用保存的副本，保留聊天文字；用户电脑或 NAS 上的原始来源文件不受影响。表 `ai_chat_attachments` 增加 `created_at`、`deleted_at` 与查询索引（schema9→10 事务增量迁移，不新增表、不删除旧行），保留元数据墓碑；聊天附件显示「已清理」。恢复历史时跳过已清理正文，保存历史也不会复活这些文件。当前 AI 正在生成或等待命令处理的聊天禁止清理，服务端再次检查；清理空闲聊天会同步移除其活动模型上下文中的附件，其他聊天正在生成的消息对象保持不变。磁盘清理失败时返回待重试状态，可通过清理无引用附件或下次自动清理重试。

新增接口：`GET /storage/attachments`（分页和筛选）、`POST /storage/attachments/delete`（所选 ID、明确 confirmed）、`POST /storage/attachments/orphans`（confirmed）。沿用管理员网关、所属账号和 CSRF 检查，不返回原始附件数据、存储路径或供应商密钥。用户手动清理某个账号的附件不会清除其他账号仍引用的文件。

验证：417 项全量测试通过；最后布局调整后，24 项相关测试再次通过。覆盖 HTTP API 缺失复现、schema9附件文件保留迁移、年龄筛选、墓碑不复活、跨账号保护、忙碌对话保护、活跃上下文清理、不截断其他流式会话、公共 UI 清理确认与各类接口鉴权。Lint、Prettier、前后端类型检查及 FPK 构建通过。

schema10 NAS 发布验收：SSH 保留数据更新成功，运行及登记版本仍0.2.52。26表业务行数保持，迁移表增加版本10，完整性ok、外键错误0，含附件列表的12个关键接口200。NAS隔离测试验证“清理→再保存旧历史不复活→关闭重开→聊天仍可恢复并标已清理”，临时测试目录已清理；未清理正式附件。

## 聊天图片预览（保持 0.2.52 / schema11）

2026-10-22：发送前和聊天消息中，PNG/JPEG/WebP 图片显示缩略图，点击放大预览；历史图片按需读取。放大界面复用公共弹窗标题、关闭及遮罩/ESC交互，图片按可视区域等比适配；不执行图片中的内容。已清理图片仅显示状态，加载失败显示错误。组件卸载或切换附件后忽略旧请求响应。

新增 `GET /terminal/ai/attachments/:attachmentId/preview`，使用既有 ApiClient、管理员网关和账号身份校验，返回图片 MIME/base64；不将图片正文加入轮询快照，不公开数据目录。读取再次检查所属账号、图片类型、删除状态及原文件大小/SHA-256，拒绝其他账号、文本、缺失或损坏文件；响应 no-store。原图仍保存在附件目录，SQLite仅保留元数据，没有 schema 变更。

附件按钮移至审核/静默按钮右侧，发送/停止仍独立靠右。系统设置「AI 接入」增加「Skills 技能」管理入口，复用 SSH AI 的技能管理组件。用户补充要求保留左侧面板关闭按钮，本次未移除。

434项全量测试、strict类型/113前端源文件AST、ESLint、Prettier及原生FPK构建通过。新增真实API回归覆盖图片内容与no-store、账号隔离、非管理员403、文本拒绝和清理后404；UI回归覆盖草稿缩略图/放大关闭、迟到响应及清理状态。独立代码复核未发现重要问题。浏览器以实际组件和公共发行CSS检查桌面及390px宽度预览；截图 ai-image-preview-mobile-v052.png。没有向真实模型发送图片。

NAS验收：通过SSH替换server/dist并启动，运行/登记0.2.52、服务running；schema11/27表所有行数保持、完整性ok、外键错误0；13关键接口200、未授权403。隔离临时应用验证真实图片读取、no-store、跨账号404、未授权403及清理后404；临时目录已清理，未改正式聊天附件。前端index SHA256 70648acaed055c347c36fe5c355493e088eaaf8e1bffdb365e41693c0564710e；FPK SHA256 ffd93c42374063c63c607d5e2661bb0743ce30c47f568833fc3d948a23d64e06。

## 附件管理界面统一（2026-10-22）

用户确认仅调整点开后的管理界面。收紧公共storage-record-manager正文顶部留白、统一左右24px内边距；统计移到底部操作区。搜索采用公共search壳及图标；类型和时间使用公共toolbar-select及成组筛选布局，移动端保持完整标签。表格采用公共dialog-table列类型，选择40px、类型64px、大小80px、会话22%、时间156px，其余留给名称；不新增附件专用表格体系。

移动端沿用storage-history-selectable和history-record-card：选择框位于卡片左侧，卡片按名称、类型/大小/时间、会话排列；点击整卡或选择框同步选择，处理中附件禁用。保留手机加载更多、桌面公共分页，清理仍需原有确认。

浏览器还复现原生dialog顶层遮挡下拉弹出层：下拉已展开但选项不在可访问/可见界面内。使用Semi ConfigProvider将本面板内的筛选和分页弹出层统一挂载到当前dialog，不改全局挂载策略。已实测类型选择、分页条数选项、390px移动端整卡选择与计数。新增移动选择回归先失败后通过；435项全量测试、strict/114前端AST、lint、格式及FPK构建通过。截图storage-attachments-mobile-layout-v052.png。未清理正式数据。


NAS验收：经SSH停止服务、仅替换dist并启动完成，未使用应用中心更新；服务running，运行及登记0.2.52，schema11/27表行数全部保持，数据库完整性ok、外键错误0；13关键接口200、未授权403，独立首屏及主题按钮状态保持。没有清理正式附件或更改聊天记录，部署暂存目录已清理。前端index SHA256 d54fdc97bfd1ee4f673e6c3b098e778c975b61c44b370d0ca4eb730748c81bbf；FPK SHA256 d9930e7be24897b3a245e1fd7cd6d891d28216f8a1249428023120a70f4ee35a；运行归档SHA256 34ae3ee5519729a6059a7c22aab88afd2ff32f0854385be737419594a0adcb42。
