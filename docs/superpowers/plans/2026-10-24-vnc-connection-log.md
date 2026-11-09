# VNC 连接日志

已确认方案：VNC 左侧工具栏图标展开公共侧栏；显示阶段、时间、耗时、结果，支持复制和清空。记录只随当前连接标签存活，不写数据库。每标签最多200项，后端已断开的诊断缓冲限时保留供前端取回，读取严格校验owner；从不记录凭据、票据、输入、剪贴板或画面字节。

1. 后端领域定义和内存诊断存储；VncTransport记录会话、WebSocket、DNS、TCP、RFB banner与安全错误码；保留短期关闭诊断，DELETE清理；GET sessions/:id/logs经现有owner guard。测试用户隔离、连接拒绝、握手、关闭后取回、缓冲与期限。
2. 前端每DesktopView独立日志模型，去重拉取后端诊断、关闭后取回再清理，过期请求不可串入重连/清空后记录。补接noVNC认证选择事件及失败、连接、断开、握手超时等已有事件。
3. 日志内容组件复用公共header、图标按钮、滚动条和侧栏；工作区挂载公共terminal-assets，支持互斥、切标签、关闭清理、现有拖拽、小屏底部面板。复制复用clipboard工具。
4. 单元/API/UI回归，lint/format/types/full tests/build/package，隔离夹具和NAS真实Mac成功/失败状态检查，SSH停止替换启动保留数据，数据库与接口验收，更新文档。
