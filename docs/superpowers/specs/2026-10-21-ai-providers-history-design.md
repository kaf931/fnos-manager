# 多供应商 AI 与最近 50 个对话

用户已要求支持多个供应商，协议 OpenAI、Claude、Ollama；设置右侧添加新建会话与历史按钮。用户确认按最近 50 个完整对话持久保存，刷新、关闭 SSH 和 NAS 重启后保留。延续现有公共面板、NativeSelect、弹窗、滚动条、无边框输入卡片和审核/静默权限。

配置按所属账号保存名称、协议、根地址、默认模型、API Key；公共接口不返回 Key。OpenAI 使用 chat/completions 与 models；Claude 使用 messages 与 models、x-api-key/anthropic-version、tool_use/tool_result；Ollama 使用 api/chat 与 api/tags、原生 tool_calls/tool_name。原生协议初版使用有界普通 JSON 完整响应，OpenAI 保留 SSE；不伪装成同一协议。地址占位明确根路径，提供默认地址；所有 HTTP 请求限制重定向、时限和响应大小。

schema v4 新增 ai_providers 与按账号隔离的对话/消息/命令/协议消息关系表。v3 ai_settings 事务迁移为一个 OpenAI 默认供应商后移除旧表；v2 先经过 v3 迁移再到 v4。旧 SSH、任务、扫描记录保留。AI 对话最近 50 个按账号保留，淘汰时级联清理明细，保留当前活动对话；协议消息的工具参数是允许的具体 JSON 字段，不保存整个业务对象 JSON。

聊天继续绑定当前 SSH。新建先取消当前轮次，清空当前面板并开始新对话。历史按时间倒序显示标题、时间及原 SSH 资产；仅允许恢复同一资产的对话到当前 SSH。恢复时旧 pending/running 改为 expired，补齐悬空工具结果；不会重放旧命令，权限恢复默认审核。历史不保存 SSH 密码、模型 Key；仅保存用户提交文本、AI 回复、实际确认/静默执行的命令及结果。每个对话上下文仍限制 512 KiB，命令/输出/时限/轮次限制不变。

左侧拖拽功能已实现并独立验收：360px 默认、240–640px 并按窗口限制，鼠标 col-resize，键盘左右调节，切换菜单共用宽度，移动端不显示拖拽条。负载行默认单行。
