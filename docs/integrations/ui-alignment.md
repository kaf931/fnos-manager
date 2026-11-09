# 飞牛 UI 对齐依据与核验范围

初始实测版本：0.2.1；基准：用户 NAS 的 fnOS 1.2.0800 Docker 原生应用；初始记录时间：2026-10-18。下文实测数值保留来源，当前主题策略已按用户偏好更新。

## 官方公开要求

来源：https://developer.fnnas.com/api/page/ui/ 及项目安装的 @trimjs/web-app 0.5.0 README/源码。SDK通过getPlatformConfig().theme/language读取初始配置；仅在isWeb && !isStandaloneWeb时监听os/theme、os/language。0.5.0源码明确$on不支持手机App运行环境，不能声称手机App也提供同样事件。setTitle同步菜单窗口标题；编辑表单input/change后setExitPageTips，关闭或保存后清除提示。独立浏览器补充beforeunload。

当前项目默认跟随系统，内嵌桌面由SDK配置及os/theme事件更新颜色，独立浏览器补充prefers-color-scheme监听。用户已明确要求保留主题快捷按钮；手动浅色/深色保存在SQLite，优先于系统变化。恢复“跟随系统”后继续使用最近接收到的系统主题。宿主SDK只提供模式信息，页面颜色仍由公共主题变量和Semi主题共同应用。2026-10-21官方文档站读取失败，本次运行边界以安装的官方SDK说明及源码核验，不将其他开源应用的实现当作官方保证。

## 原生实测依据

原生 Docker 按钮的 DOM 使用 semi-button 系列类名。读取 DOM 可见控件的 computed style 与已加载 CSS 主题变量，保存为 fnos-1.2.0800-light-tokens.json、fnos-1.2.0800-theme-rules.json。不访问用户令牌、会话存储或业务接口。

- 原生浅色主色 rgb(0,102,255)，使用 --semi-color-primary，不使用之前自选 #3478f6。
- 字体 PingFang SC / SF Pro Text / Helvetica Neue / Helvetica / Arial，常规正文 14px/20px；按钮为 14px、600。
- 官方刷新按钮实测高度 28px，水平内边距 12px，圆角 6px，边框 rgba(14,14,15,.16)，文字 rgba(14,14,15,.75)。工具栏使用相同尺寸；弹窗操作使用 32px。
- 官方导航实测高 36px，padding 8px，选中背景 rgba(255,255,255,.5)，选中文字主色，500 字重。
- 亮暗主题均来自原生 CSS 的主题和调色板声明；映射到本应用 CSS 变量，覆盖按钮、输入、导航、表格、弹窗、日志、危险/成功状态；取消自定义渐变、模糊遮罩与装饰性阴影。
- 修复旧样式 run-item/run-output 与实际 run-record/task-output 不一致导致日志没有样式的问题。窄屏保留两个功能菜单。

## 限制

公开“页面交互”文档不是完整视觉设计系统，未找到官方公开的完整组件包、字号间距验收表或认证流程。本应用仍为独立 HTML/CSS 控件，以原生实测主题为依据；不冒充官方组件库，也不声称获得官方认证。没有明确公开规则的布局为项目实现选择，不能把实测约定描述为官方强制规范。系统升级后需重新核验。

## 图标主体尺寸修复

0.2.3 去除每轮 90% 缩小及重复透明边距，按 alpha>=8 的可见边界裁去透明画布后等比适配 64/256 正方形，保留图像真实颜色区域和圆角主体。透明边界只做一次有效规范化；再次经过保存或打包不会继续缩小。官方并未指定统一 90% 主体占比，原实现属于项目错误。新增测试覆盖连续四轮处理与64px输出，防止留白累积。

### 手机 App 打开本机 Docker 快捷入口
官方应用入口文档区分端口服务与 CGI：端口服务不依赖 NAS 用户登录态；CGI 会先验证 NAS 登录态。type=url 可在外部浏览器/WebView打开，手机App的登录态不能假设由外部浏览器继承。
0.2.7 对 containerId 存在且目标主机匹配当前 NAS 网卡地址/主机名的入口，使用官方 protocol、port、url 字段直接打开服务，保留路径、query、hash及打开模式。外部主机地址仍保留原路由，不能将任意外部地址错误拼接为NAS主机端口。此改变不能代替远程端口可达性配置。
参考：https://developer.fnnas.com/docs/core-concepts/app-entry 、 https://developer.fnnas.com/docs/core-concepts/index-cgi 、 https://developer.fnnas.com/api/page/routing 。

## 表单控件复用约定
- 凡表单包含下拉，统一调用 web/task-form-controls.js 的 createTaskFormControls，内部统一使用 NativeSelect；不要另建可见原生select。动态弹窗关闭调用返回函数的dispose释放React根节点。目录和指令编辑不含归属下拉，归属通过树拖拽管理。
- 标签用label[for]关联独立字段；输入及textarea沿用task-form-body/terminal-dialog公共样式。打开弹窗使用openEditorSurface复用桌面模态和移动页面模式。
- 目录下拉需允许根目录空ID，使用data-allow-empty=true；其他使用空值作为placeholder的下拉保留原逻辑。
- 普通输入与textarea的公共聚焦规则按.task-form-body/.form-panel结构生效，不枚举表单ID：单层蓝色边框、outline:none、box-shadow:none，确保动态弹窗也能复用。

## 移动工具栏与卡片间距

2026-10-19 按用户确认，<=620px 时桌面图标、计划任务与 SSH 连接列表统一使用同一条移动工具栏规则，按钮行所在工具栏到首张内容卡片为 16px。搜索行至按钮行仍使用既有 12px row-gap。此处为项目统一约定，不声称官方强制像素规范。

## 共用面板与确认（2026-10-20）

编辑通过 openEditorSurface 打开（桌面居中、手机最大 88svh 底部面板），确认通过 confirmation.js 打开统一居中确认框。二者复用 dialog-controls.js 的关闭图标与 dialog-dismiss.js 的幂等遮罩处理；业务忙碌时通过 cancel.preventDefault() 阻止关闭。禁止再定义独立的遮罩点击监听或复制确认模板。最终几何与移动字段尺寸集中在 shared-surfaces.css：手机字段 40px / 16px，图标点击区域至少 40px。桌面仍沿用 32px 字段基准。
