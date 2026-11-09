# 实施顺序

1. 用失败测试覆盖多供应商账号隔离、协议与 Key 更新、v3→v4 升级；实现关系表和 Repository。
2. 用官方协议的 HTTP mocks 验证 Claude/Ollama 的工具调用与结果回传、模型列表、畸形响应、超时与 Key 隔离；接入现有 AiProvider。
3. 实现对话持久化、最近50、取消/新建/同资产恢复、旧提议失效；覆盖服务重启、跨账号、跨资产和不重放命令。
4. 接入 Nest DTO/API；前端供应商配置列表、分组模型选择、新建与历史按钮及公共历史面板。
5. lint/typecheck/format/test/build；浏览器验证三种协议配置、模型切换、新建/历史恢复和拖拽。当前用户本轮未要求 NAS 发布，先本地完成并提供结果。

## 实施结果（0.2.13，本地）

- 完成多供应商配置/编辑/删除与模型发现；OpenAI 保留 SSE，Claude 与 Ollama 使用原生普通 JSON 工具协议。已检查官方文档： https://platform.claude.com/docs/en/api/messages/create 、 https://platform.claude.com/docs/en/api/models 、 https://docs.ollama.com/api/chat 、 https://docs.ollama.com/api/tags 、 https://docs.ollama.com/capabilities/tool-calling 。
- schema v4 已实现事务升级；v3 ai_settings 迁移到 ai_providers 后移除旧表。新增 ai_chats、ai_chat_messages、ai_chat_proposals、ai_chat_protocol，只有工具参数使用特定 JSON 列。最近50个对话按账号保存，保留最多8个活动SSH对应对话，自动清理其他较旧记录及关联明细。
- 新建会话、历史列表/详情、同资产恢复已接入。一个聊天只允许绑定一个活动 SSH 会话，旧提议过期，恢复不重放，权限回到审核。磁盘写失败不阻断 SSH 资源清理。
- 左侧公共面板默认360px，负载标签与12.34 / 56.78 / 90.12实测行高18px且不截断；拖拽360→420px并切换AI保留420px，释放后cursor状态正常；支持键盘左右/Home/End。没有分界线变色。
- 模型框为固定160px，较窄面板100/80px固定档位。两下拉靠左，图标按钮靠右，浏览器实测left gap0/right gap0、下拉间距6px。
- 262/262测试通过，lint/typecheck/format通过，浏览器完整验证多供应商新增、Claude/Ollama工具确认/输出/总结、新建及历史恢复。使用本地HTTP协议mock和真实SSH fixture；未声称真实模型账号连通。
- 已补充ABA/新会话请求失效、模型发现旧请求、并发恢复互斥、活动记录保护、SQLITE_FULL清理等回归。截图 docs/screenshots/terminal-ai-providers-history.png。
- 本轮未操作NAS发布；NAS仍为0.2.12/schema v3，现有数据不变。打包结果在本文件后续记录。

最终打包完成：`build/deskicons/deskicons.fpk`，版本0.2.13。完整测试262/262，lint/typecheck/format:check全部成功；构建仅有既有大bundle提示，依赖审计0漏洞。浏览器验证截图已保存。本轮未更新NAS。


## NAS 发布验收

用户随后明确要求更新，已发布0.2.13/schema v4。运行依赖与0.2.12一致，停机替换生成运行文件后启动增量迁移；旧业务记录数量一致，完整性/外键/文件权限通过。五菜单、供应商和历史只读接口200；非管理员403，无CSRF修改403。NAS静态index的SHA256为 f2dd029a10554d11a49e58eeae47289853d10255a2888b38e295ba424e86f8a8，与最终发行包一致，引用资源200。无生产模型配置，未向NAS写入测试供应商或测试聊天；真实供应商连通性仍需用户配置后确认。此前“未发布NAS”的文字为发布前状态。
