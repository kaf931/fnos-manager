# SSH 工作区 AI 助手设计

状态：用户已于 2026-10-21 确认设计，待实施计划确认。用户已确认自定义 OpenAI 兼容地址、API Key、模型；每条 SSH 命令展示并人工确认后执行。

## 目标及界面

在终端全屏工作区图标栏中，将 AI 助手置于资产列表上方，与资产、快捷指令、文件传输、系统监控互斥显示。复用 .terminal-assets、公共滚动条、按钮、输入框、弹窗、密码显示组件和主题变量；桌面面板宽度沿用 240px，移动端沿用既有底部面板。面板头显示 AI 助手、设置及收起；对话区在中间，输入与发送固定在底部。

初次打开配置 API 地址、API Key、模型。配置入口位于面板头，使用当前公共表单弹窗。可手填模型；首版不依赖模型自动发现。无连接时可配置，但执行入口不可用。切换终端标签切换对应会话对话，关闭 SSH 会话清空对话和待执行命令。配置跨刷新保留，聊天仅保留当前 SSH 会话。

## 模型通信

后端负责请求配置地址的 /chat/completions；用户输入兼容 API 根路径（例如以 /v1 结束），后端规范化一次，限制 http/https、长度、无 URL 用户名密码。允许用户选择局域网模型服务，不强制公有 IP。API Key 仅从账号配置读取，前端普通配置查询返回 hasKey，不回传已保存 Key；修改界面 Key 留空保持不变。错误和日志不得打印 Key、SSH 认证字段或完整请求体。

使用 Chat Completions function tools，公开唯一 run_ssh_command(command, explanation) 工具。模型输出只作为提议，绝不直接执行响应中的代码块。工具参数以 unknown 接收并运行时验证，限制指令长度 16 KiB，不允许控制字符。流式响应应正确拼接 content 及 tool_calls 参数，协议不兼容时明确提示，不伪造执行结果。模型由用户明确设置，不自动选择收费型号。

## 命令确认及执行

后端在对应 owner + SSH session + conversation 中保存命令提议，分配不可猜测 ID。聊天界面显示目的、完整命令、执行和拒绝按钮。执行请求只提交提议 ID，不能替换命令；后端重新核验账号、当前 SSH 会话连接状态及提议状态。只有用户点击执行才允许进入 running，重复请求拒绝，切换/关闭连接后旧提议失效。

通过当前 SSH 连接的独立 exec 通道执行，不向交互终端盲写内容；默认从该账号的 SSH 工作目录执行，需要目录的命令必须显式包含目录切换。不保证沿用交互终端中的 cd 或环境变量。最长 30 秒，每次合计 stdout/stderr 最多 64 KiB，记录退出码、超时、截断和失败状态；会话关闭/取消时终止通道并取消模型请求。

命令输出作为工具结果加入该会话对话，再由模型总结或提出下一条命令；每条后续命令仍单独确认。拒绝也回传工具结果，不能保留悬空 tool_call。每个用户问题最多 10 次工具轮次，单会话最多一个生成/执行过程，避免失控循环和重复执行。

仅发送用户主动提交的消息、对应命令与执行输出给配置的模型服务；不自动上传整个终端历史、文件内容、SSH 密码/私钥。首次配置及命令确认处明确这些数据流。

## 工程与持久化

沿用 Nest Controller -> application service -> AI/SSH 业务服务 -> Repository；DTO 验证、现有管理员/所属账号/CSRF Guard。新增 backend/domain/ai.ts、backend/terminal/ai/ 的 provider/conversation/executor；业务服务不依赖前端状态。Controller 不直接操作数据库。

SQLite 新增 ai_settings(owner_uid PRIMARY KEY, base_url, model, api_key, updated_at) STRICT 表；账号非空、字段非空约束，时间为 UTC 毫秒。服务内部使用明文 Key，数据库维持现有 0600 和受限数据目录。schema v2 -> v3 只做新增表的短事务升级，不修改既有业务行；升级登记 schema_migrations，失败回滚。运行期不保留旧模型接口实现或通用 JSON 仓库。聊天与待执行命令保存在会话内存，随关闭清理。

建议接口：GET/PUT /terminal/ai/settings；POST /terminal/sessions/:id/ai/messages；GET /terminal/sessions/:id/ai/conversation；POST /terminal/sessions/:id/ai/proposals/:proposalId/execute 或 reject；POST /terminal/sessions/:id/ai/cancel。所有数据按账号和 SSH 会话隔离。

## 验证及交付

先用本地 OpenAI 兼容 mock 与 SSH 测试服务器验证完整对话 -> 提议 -> 确认 -> exec -> 工具输出 -> 总结；覆盖跨账号、会话关闭、重复确认、超时、输出截断、拒绝、多工具轮次、Key 脱敏和升级保留既有数据。未提供实际模型凭据前，不声称已验证真实模型连通性。

完成 lint、typecheck、format:check、全套测试、构建和安装包后更新 NAS，保留现有数据。真机确认菜单位置、配置持久化、未确认不执行、关闭会话清理；不自行对 NAS 执行重启、关机或文件删除。

## 参考（2026-10-21 联网查阅）

- https://github.com/gnmyt/Nexterm ：SSH/SFTP 工作区与可配置 AI 系统提示。
- https://github.com/musanmaz/nexterm ：兼容模型服务、聊天面板和命令运行入口。
- https://developers.openai.com/api/docs/guides/function-calling ：模型提议、应用执行、工具结果回传的调用流程。
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create ：Chat Completions tools、tool_calls、tool_call_id。

兼容模式要求所选服务和模型支持 Chat Completions function tools。不能把所有新 OpenAI 模型默认视为兼容；官方当前文档指出部分模型仅支持 Responses 工具调用。首版不增加第二套协议，若服务只支持 Responses，需后续明确增加适配。


## 2026-10-21 用户确认的界面与权限扩展

审核命令固定于无边框输入卡片上方，间距 8px；发送和停止共用图标按钮，左侧为模型与执行权限下拉。默认审核；用户已明确同意主动选择静默后自动执行，仅在当前 SSH 会话生效，切换会话恢复审核。后端每个问题显式传 executionMode，遗漏默认审核，静默顺序执行且沿用取消/所属账号/长度/输出/时间/轮次限制。模型列表使用配置服务的 /models，失败时保留配置模型。所有滚动条使用公共样式。此扩展取代前文“只支持逐条审核”的限制。
