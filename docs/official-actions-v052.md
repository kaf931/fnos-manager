# 0.2.52 官方授权按钮统一

日期：2026-10-22。计划任务的生成授权链接、完成连接及断开连接三个按钮改为公共dialog-action。尺寸与dialog-footer按钮共用规则：桌面height32px/min-width72px，移动底部面板复用公共min-height40px；字号仍为公共14px。

独立的按钮ID右对齐、18/14px间距及断开按钮颜色规则已移除。公共dialog-action提供右对齐、16px上间距，断开连接使用既有danger类别，危险按钮按公共主题令牌提供交互反馈。

桌面浏览器读取三个按钮计算样式均height32px、min-width72px、margin-top16px；390px移动面板视觉验收正常，按钮复用40px规则。仅打开隔离预览授权面板，没有生成授权链接、连接官方服务或断开真实连接。截图official-actions-desktop-v052.png、official-actions-mobile-v052.png位于docs/screenshots。

389项测试、strict、109文件审计、ESLint、Prettier及FPK构建通过。部署结果见backend-architecture.md的0.2.52条目。
