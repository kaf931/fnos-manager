# Deskicons Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the current session.

**Goal:** 创建 Docker 和自定义桌面图标管理器，生成官方格式快捷入口包。
**Architecture:** Node/Express 提供只读 Docker 发现、图片处理、配置持久化与入口包生成；原生 HTML/CSS/JS 经 Vite 构建并接入飞牛 SDK。
**Tech Stack:** Node 22、Express 5、Sharp、Vite、@trimjs/web-app。
**Spec:** docs/superpowers/specs/2026-10-18-deskicons-design.md

## Global Constraints
- 官方图标 64/256 PNG，sRGB，不超过 1024 KB。
- 无系统页面注入；不声称支持未验证的动态桌面注册。
- 无容器启动、停止、exec 能力。
- 本地回环监听，真实 Docker 不可用时明确提示。

## Review Focus
- Docker 不可访问：可操作错误，无伪造真实数据。
- 多映射端口：保留所有候选，允许选择。
- 图标下载失败或超限：允许回退，限制下载与像素。
- 配置写入与路径注入：原子写入，ID 校验。
- 导出与桌面状态：保存与安装明确区分。

## Tasks
1. 核心模型与 Docker 归一化：server/core.js，tests/core.test.js。先写测试并运行确认缺失，再实现 validateEntry、normalizeContainer、entryConfig。
2. 图标管线与包生成：server/icons.js、server/package.js，tests/package.test.js。先验证输出尺寸和入口内容，再实现。
3. API 与持久化：server/index.js、server/store.js，tests/api.test.js。验证创建、重启读取、更新、删除和非法输入。
4. 管理界面：web/index.html、web/main.js、web/style.css。Docker 选择、编辑弹窗、预览、导出、明暗主题和失败反馈。
5. 打包与交付：scripts/package.js、README.md。执行 npm test、npm run build 和快捷方式包构建，检查生成内容。实机验证保持未完成标记。
