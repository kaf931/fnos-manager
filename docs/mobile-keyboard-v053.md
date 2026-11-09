# 移动键盘布局调整（0.2.53，已撤销）

2026-10-22。用户要求先更新后手动真机测试。随后用户要求撤销本次修改，源代码已恢复0.2.52；下文为已撤销版本的历史记录。

旧实现等待视口缩小超过120px或18%后才隐藏导航，同时切换内容高度及底部留白，存在菜单先上移再隐藏、内容再次改变布局的风险。改为移动端编辑框focusin同步隐藏导航，resize只跟踪键盘状态；失焦但键盘仍占用视口时维持隐藏，视口恢复后显示。若收起键盘但输入框仍保持焦点，导航继续隐藏至结束编辑。桌面导航不受影响。

移除键盘状态下主区域高度/底部margin的特殊规则、列表和系统设置72px→8px的padding切换。保持原有内容尺寸规则和可滚动区域，不添加键盘高度补偿、scrollIntoView或焦点操作。导航和底部遮罩的隐藏属于可见性切换。

新增DOM事件回归：focusin在resize及下一帧前隐藏、失焦后等待视口恢复、恢复显示及桌面编辑保持导航。旧实现先失败，修改后通过。全390项测试、strict类型检查、前端AST审计、ESLint、Prettier及原生包构建通过。DOM测试模拟视口变化，不能证明实体手机输入法动画帧率；真机流畅度待用户测试。

已通过SSH停止独立入口及主应用、替换运行文件、依次启动，保留现有数据。实际运行0.2.53，应用中心登记仍0.2.23。两应用running，11个关键接口200，未授权403；25张表行数保持、schema8、integrity_check=ok、foreign_key_check=0。前端index SHA256 d25daddd91515dc48b4afedc1a5690bf5624482b078db57c06c327eaf2bf64af，与本地发行包一致。未进行真实设备电源控制或用户文件操作。

参考：
- https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets
- https://developer.chrome.com/blog/viewport-resize-behavior
