# 结构整改与官方文档复核

后续全量前端迁移已于 0.2.47 完成，当前范围与验证见 [全量统一报告](full-typescript-ui-review.md)。以下为 0.2.46 历史记录。

日期：2026-10-22；运行发行版本：0.2.46；数据库schema：v8。本轮保持现有接口、权限、业务行为和数据结构。

## 已落实的六项审查问题

| 项目 | 调整 | 验证 |
| --- | --- | --- |
| CSS覆盖分散 | native-ui.css和storage.css成为有序入口；组件规则归入web/styles，工具栏集中到shared-toolbars.css，合并29条被后续覆盖的声明 | 旧/新CSS最终声明契约对比：原生2049项、存储1201项均保持；375/620/621/850/1100/1440计算样式对比无差异 |
| 控制器职责过重 | 图标安装/生成/修订、任务校验/权限/执行、连接及会话事务移入应用服务；常用命令仓库由服务封装；普通JSON使用Nest返回值 | API回归与新增应用服务测试，包括真实SQLite的账号隔离和修订号 |
| 文件管理组件过大 | terminal-files.js从971行缩为333行；拆出列表、菜单、交互、尺寸调整、操作、上传、名称对话框和图标 | 8项新行为测试，原有文件/目录/上传回归；15个抽取函数AST与原实现一致 |
| 生命周期临时包装 | 删除图标Store无效pending/init及虚构关闭资源；存储服务显式幂等关闭，逐项尝试、聚合失败；数据库最后关闭 | 关闭幂等、单项失败后仍关闭其他资源、启动中途失败清理测试 |
| 静态检查环境混用 | 浏览器与Node分别配置ESLint全局；DOM测试仅放开模拟document/window；新增跨运行时误用的负向测试 | lint-boundaries先观察旧配置失败，再验证新配置通过；完整ESLint通过 |
| 文档滞后 | README按实际六菜单、NestJS/SQLite、明文凭据、快捷指令自动回车、会话传输记录及SSH部署重写 | 对照当前源码与构建命令核查，不再将旧JSON/加密密钥视为运行数据 |

另：修复存储CSS中悬空选择器导致的无效移动媒体规则；窗口标题、菜单、滚动条及飞牛主题适配仍复用既有公共实现。

## NestJS 官方文档复核

- [Providers](https://docs.nestjs.com/providers)：控制器接收HTTP请求，复杂工作委托Provider。本轮按该职责收拢应用服务，没有强行更换已支持的异步工厂Provider。
- [Controllers](https://docs.nestjs.com/controllers)：普通返回值交给Nest序列化；文件图像、下载及上传流继续使用Express响应，监控设置Header使用passthrough。创建/异步任务/无内容响应分别保持既有201/202/204。
- [生命周期](https://docs.nestjs.com/fundamentals/lifecycle-events)：Resources实现启动与销毁钩子，调度在启动完成后开始；应用关闭先停工作者再关数据库，启动失败也执行清理。
- [验证](https://docs.nestjs.com/techniques/validation)：保留全局ValidationPipe的transform、whitelist、forbidNonWhitelisted、forbidUnknownValues及DTO验证；管理员鉴权和写请求令牌检查仍位于网关边界。

Nest的模块目录、工厂Provider以及流式响应都是官方支持方式。这里采用的文件拆分方案不是Nest规定的唯一目录标准。

## Semi Design 官方文档复核

- [Tokens](https://semi.design/en-US/basic/tokens)：公共颜色继续使用Semi语义变量，飞牛主题在统一映射层提供值，亮暗主题使用body的theme-mode；浏览器核验暗色切换正常。
- [定制FAQ](https://semi.design/en-US/ecosystem/faq)：全局品牌主题与局部选择器覆盖各有用途；保留飞牛的局部适配，不以“所有覆盖都违规”为由替换现有界面。
- 公共NativeSelect统一尺寸和弹层；文件菜单使用Semi Dropdown公开Item的danger属性；对话框、手机底部面板和操作按钮继续共享公共样式，不新造一份菜单皮肤。
- 滚动条保持公共2px外观、滚动时显示/停止渐隐；移动筛选保持40px触摸区域和32px可见按钮面。

## 验证证据和范围

337项测试通过，ESLint、全后端TypeScript严格检查、前端关键纯逻辑JSDoc严格检查、Prettier及原生FPK构建通过。前端类型检查覆盖Docker地址、文件模型和独立入口定义/解析；其余React和原生DOM界面仍是JS，使用ESLint和行为测试，不声称已经全量TypeScript化。

独立复查未发现新增的HTTP、权限、会话有效性或CSS层叠回归。源码已检查并验证职责边界，但“通过检查”不是对所有设备/场景零缺陷的保证。

浏览器实测320px和390px图标工具栏、卡片、悬浮导航各几何/颜色/间距项与重构前完全一致；390pxSSH编辑公共下拉和底部面板可用，存储卡片左右16px；桌面明暗主题及独立SSH入口正常。文件管理使用隔离模拟API验证展开、右键危险操作红色、创建目录与刷新列表，没有连接或操作真实主机。

截图：docs/screenshots/architecture-mobile-editor-v046.png、architecture-mobile-storage-v046.png、architecture-desktop-dark-v046.png、architecture-file-menu-v046.png。

## NAS验收

已用SSH完成保留数据更新至实际运行0.2.46，恢复原先运行的独立入口。两服务running；11个关键接口200，无管理员头访问403；独立入口初始HTML正确隐藏导航。25张表行数保持，schema8，integrity_check=ok，foreign_key_check=0。前端产物SHA256与发行包一致。应用中心登记仍为0.2.23，未通过应用中心更新。
