# Appearance Implementation Plan

**Goal:** 在外观设置提供三套配色和独立终端背景。
**Architecture:** SQLite 偏好迁移、类型化 API、公共 CSS 变量；React 设置订阅即时应用。
**Tech Stack:** NestJS / SQLite / React / Semi / xterm。
**Spec:** docs/superpowers/specs/2026-10-31-appearance-design.md

- [x] 偏好、API、旧库迁移及备份校验增加 palette/terminalBackground，验证持久化与非法值拒绝。
- [x] 公共主题 CSS 和平台订阅接入，xterm 跟随公共终端颜色。
- [x] 外观公共设置行增加选择控件，默认不改变当前样式。
- [x] 构建、测试、旧库迁移检查、NAS 保留数据部署并验收。

- [x] 设置顶部复用公共 tabs，点击定位模块，窄屏横向滚动。
