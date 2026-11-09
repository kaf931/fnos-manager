# AI 协议适配（0.2.15）

供应商协议在公共下拉框中选择，地址及模型仍可自定义。OpenAI、Claude、Ollama 保留原有入口，新增 Gemini、GLM、MiniMax、DeepSeek、MiMo。未提供真实账号的供应商通过本地 HTTP 协议夹具验证，不代表真实账号连通性已确认。

| 选项 | 默认根地址 | 请求与上下文处理 | 官方文档 |
| --- | --- | --- | --- |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | 原生 generateContent、functionDeclarations、functionCall/functionResponse，完整回传 parts 和 thoughtSignature；模型列表分页并筛除不支持 generateContent 的模型 | [工具调用](https://ai.google.dev/gemini-api/docs/function-calling)、[签名](https://ai.google.dev/gemini-api/docs/thought-signatures)、[API](https://ai.google.dev/api/generate-content) |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 Chat Completions、tools/auto、reasoning_content 内部回传 | [兼容接口](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[工具调用](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling) |
| MiniMax | `https://api.minimax.cn/v1` | 兼容 Chat Completions；reasoning_split=true；接受 finish_reason 正常结束但无 DONE 的流；保留思考上下文，显示仅包含回答 | [OpenAI SDK](https://platform.minimax.cn/docs/api-reference/text-openai-api) |
| DeepSeek | `https://api.deepseek.com` | 兼容 Chat Completions；工具对话完整保留 reasoning_content | [首次调用](https://api-docs.deepseek.com/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/) |
| MiMo | `https://api.xiaomimimo.com/v1` | 兼容 Chat Completions；Bearer 认证；保留 reasoning_content | [接口](https://mimo.mi.com/docs/en-US/api/chat)、[推理上下文](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content) |

流式处理不显示 reasoning_content、reasoning_details 或 think 标签内文本。内部协议内容与可见消息分开保存，历史接口不返回内部协议记录。`finish_reason=length` 等截断响应禁止形成可执行提议。所有协议继续经过同一命令校验、审核/静默权限、输出及上下文长度限制。

聊天和历史记录使用 Marked 渲染 Markdown，再用 DOMPurify 白名单清理。禁用图片、脚本、事件属性以及非 HTTP/HTTPS 链接；普通用户消息保持纯文本。样式复用主题变量和公共滚动条。[Marked 安全文档](https://marked.js.org/)、[DOMPurify](https://github.com/cure53/DOMPurify)。

按用户明确要求，API Key 保持明文保存，通过当前管理员账号的配置接口回填显示；不写入日志或错误内容。供应商记录保持 owner_uid 隔离。

SQLite v4→v5 在单一事务中扩展供应商协议 CHECK，并增加内部协议 reasoning JSON 元数据列，保存推理上下文及原生签名。现有业务记录不清空。新数据库直接创建 v5。
