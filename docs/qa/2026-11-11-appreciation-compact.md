# 关于应用赞赏区域布局验收

- 移除独立的支持作者卡片，合并到“关于应用”最后一行，用公共设置行的细分隔线区分。
- 桌面使用 160px 原图缩略图在左，标题、简短说明及公共“放大查看”文字按钮在右；小屏幕使用 200px 缩略图，上下居中排列。
- 原图内容保持完整，图片及文字按钮均可打开公共 medium 弹窗。
- 实际组件与生产 CSS 浏览器验证桌面、390×844 小屏幕布局、滚动和放大关闭。截图：`appreciation-2026-11-11/compact-desktop.jpg`、`compact-mobile.jpg`。
- 1096 项测试通过；构建、lint、Prettier、diff --check 通过。构建仍有既有 chunk 大小提示，JSDOM 测试仍有既有 act 环境提示。
- 已 SSH 停止、备份、替换运行文件并启动 NAS，保留应用数据，未使用应用中心升级。运行版本保持 0.4.2，应用中心登记版本不变。
- 数据库 schema 36，integrity ok，外键错误 0；原通知模板与投递数据一致，提醒事项 1 条；关键接口及生产资源检查通过。
- 数据库备份 `/tmp/notification-center-pre-1794379354368.sqlite`；运行文件备份 `/tmp/adb-runtime-backup.F9WEHG`。
