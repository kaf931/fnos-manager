# 配置备份与恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow task checkboxes and record validation.

**Goal:** 在系统设置提供可预览、有冲突保护、可选凭据的配置合并备份恢复。
**Architecture:** 独立 Nest 模块编排备份仓库，版本化配置包、账号过滤、短事务和持久幂等回执；React公共弹窗。
**Tech Stack:** NestJS / TypeScript / SQLite / React / Semi Design。
**Spec:** docs/superpowers/specs/2026-10-23-config-backup-design.md

## Global Constraints
- 当前工作目录延续此前未提交在线编辑修改，不创建不含这些改动的新基线。
- 不覆盖现有配置；恢复任务暂停且待完善电源任务不可手动执行。凭据可选，主机信任和官方令牌不导出。
- 账号边界不变，数据库仍是持久存储，导出JSON只是交换格式。
- 验证后SSH部署，数据保留，禁止应用中心升级。

## Review Focus
- 包中伪造owner或依赖映射不能访问其他账号。
- 不带凭据和目标确认的对象能导入，但不能绕过执行门禁。
- 预览过期和网络重试不得错误覆盖或重复导入。
- 目录树、设备绑定、偏好和默认命令目录关系完整。
- 非法输入、包内冲突或中途异常必须整体回滚。

## Tasks
- [x] 后端：新增backup领域类型/校验、仓库与Nest模块，schema迁移加入回执及任务待完善状态；先测试导出隔离/脱敏、合并重映射、冲突/回滚、幂等及执行门禁。
- [x] 前端：系统设置备份恢复入口，模块/凭据选择，文件导入预览，逐项跳过/新副本/兼容映射及改名，公共弹窗/表格；验证取消、错误及成功刷新。
- [x] 集成：HTTP鉴权/CSRF/DTO限制，类型、lint、格式、完整回归及构建；修复审查问题。
- [x] 文档与部署：更新范围说明，SSH停止替换启动；核对版本、数据库、接口及临时测试配置，记录实际验收。
