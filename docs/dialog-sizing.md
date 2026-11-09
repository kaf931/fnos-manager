# 公共弹窗尺寸

所有业务弹窗由 ReactDialog 输出尺寸属性，共用 web/styles/modal-sizing.css。宽度采用 Semi Design 官方规格：small 448px、medium 684px、large 920px、full-width 为视口宽度减64px。默认 medium。

- small：确认、文件重命名及简短文件操作。
- medium：常规表单、连接配置、官方授权、检查更新、目录选择。
- large：桌面图标、计划任务编辑、复杂批量操作、扫描对比、记录管理、AI 多列配置与图片预览。
- full-width：远程在线文件编辑器。

桌面最小高度174px，最大高度为视口高度减160px。普通内容按需增长；fixed布局预留560px，workspace布局预留760px，均受视口上限约束。这两种预留高度是项目约定，不是Semi强制值。标题与底部操作区固定，超长内容在正文内滚动。

移动端沿用统一底部面板：满宽、公共圆角与安全边界，不使用桌面80px上下留白。fixed和workspace通过公共变量控制稳定高度。页面不得再定义弹窗根节点专用宽高。

参考：https://semi.design/design/zh-CN/show/modal
