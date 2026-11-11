# 通知预览高度与内容卡片对齐

仅通知预览菜单增加 notification-preview-menu 适配范围：高度由 480px 改为 320px，宽度仍为 360px；圆角使用与右侧内容卡片相同的 app-content-radius（当前 12px）。其他菜单的尺寸、圆角和配色不变。

打开菜单时会计算相对右侧内容卡片的偏移，但 Semi 原本未在偏移变化且限高不变时重新定位。公共 BoundedDropdown 的 rePosKey 加入 spacing，确保新偏移立即生效。新增回归先复现失败，修复后通过。

71 项相关测试、类型检查、生产构建、ESLint、格式及 diff 检查通过。真实组件和生产 CSS 浏览器验证（1100×650）：通知菜单为 360×320px，菜单与右侧卡片 left 均为 180px、bottom 均为 642px，圆角均为 12px。内部消息滚动和固定底部操作栏保留。

![通知菜单与右侧卡片对齐](inbox-alignment-2026-11-11/menu.jpg)

## NAS 更新

已通过 SSH 停止、备份、替换运行文件、启动，保留数据。运行版本仍为 0.4.2，应用中心登记版本未变。服务、关键接口及生产资源正常；数据库 36、完整性 ok、外键错误 0，原模板和投递记录一致，提醒仍为 1 条。

- 数据库备份：`/tmp/notification-center-pre-1794377921203.sqlite`
- 运行文件备份：`/tmp/adb-runtime-backup.ORTzAC`
