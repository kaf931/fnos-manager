# 计划任务启用开关

2026-10-24，版本 0.3.1。

PC 表格“状态”列更名为“启用”，使用公共 Semi Design Switch；移动端卡片底部显示同一组件，更多菜单移除重复启用/暂停项。移除编辑表单的“保存后启用任务”与说明及对应专用 CSS，单独的最长执行时长字段不再为已移除控件保留空列。

新建任务始终默认暂停；编辑保存沿用列表中当前已知启用状态，避免普通编辑误关闭已启用任务。缺少官方授权、恢复配置待完善或任务正在执行时展示禁用原因。已启用但授权丢失的任务仍允许关闭调度；服务端仍校验所有写操作。

切换期间使用公共加载态并禁用该任务的重复操作。成功后重新读取任务及下次执行时间，失败保留原值并提示；不调用立即执行 API。设备关机/重启任务启用前沿用原目标确认。当前运行中的任务不通过该开关终止。

693 项完整测试通过，覆盖重复点击、请求失败回退、新建默认暂停、编辑保留启用、授权与待完善/运行状态禁用；类型、契约、Lint、Prettier 与打包检查通过。ARM64 与 x64 包分别构建，未向 x64 NAS 部署 ARM 文件。

## NAS 验收

通过 SSH 停止、替换前端、启动更新，运行 0.3.1、应用中心登记仍 0.2.52。PC 表头“启用”及公共开关、编辑弹窗无启用字段、390×740 移动端卡片底部开关均已查看；未保存编辑、未启用真实任务。原任务 enabled=0 不变。16 个关键接口 200；schema22、integrity_check=ok、foreign_key_check 无异常；业务记录数量不变。前端 SHA-256 `a3526efe1d7cc891c479fae77fcd69cc3e034e92f90b79ced9f8b6237cab33ec`。

最终 x64 包 `build/deskicons/0.3.1.fpk`，SHA-256 `aaa4d9c6576d2f38b29d61c79be403ad19a32e37c0b949bded1220f40a4b27a2`；ARM64 包 `build/deskicons-arm64/0.3.1-arm64.fpk`，SHA-256 `26a92ebd7f2d71a962e3bfc8c374874c6650fc5402f47a607465bfbad96700fe`。ARM64 仅构建及架构校验，未真机验收。

## 移动端开关加载抖动修复

原实现直接复用 Semi Switch，并无独立开关皮肤；但外层普通 span 遇到组件的 loading（inline-block→inline-flex、knob→spinner）时基线变化。隔离浏览器复现：普通状态底部行高 48px，loading 时 51.5px，外层由 24px 变 27.5px。

增加公共 ui/switch-control.tsx，用 inline-flex 外层稳定基线，不改变 Semi 自带尺寸、颜色、滑块或加载样式；计划任务、系统设置及常用命令提示设置均复用。移动卡片文字省略规则排除该公共开关容器，避免裁剪焦点外框。再次实测普通/loading 状态行高均 48px、容器均 24px、开关 y 坐标均 12px。隔离复现未访问任务 API，临时页面和服务已清除。

693 项完整测试、类型/契约/Lint/格式及 x64、ARM64 构建通过。ARM64 仍未真机验证。

已通过 SSH 替换前端并启动。NAS 移动端确认 `.switch-control .semi-switch` 公共结构正常，未改动真实任务状态，enabled 仍为 0。任务/能力/偏好/命令目录接口均 200，数据库完整性 ok、外键无异常。前端 SHA-256 `6a2a43c5841e587465a35840ef5431ccfb7dad6358f22999180556f7a982c623`；运行 0.3.1/登记 0.2.52，数据保留。当前 x64 包 SHA-256 `7f40080847185f1a04615708441c202c123cfe5958fe85f2f79a79b2ab2ff360`，ARM64 包 `0257b0ad11aad8daa7b35e388e5e1e73cd3ad8eec7c8842a08874d182a510174`。

## 点击焦点框

公共 SwitchControl 统一区分指针与键盘聚焦：点击/触摸不保留 Semi 蓝色焦点框，Tab/键盘操作继续显示公共焦点提示。不使用 blur 强行丢弃焦点，也不修改全站其他输入框的焦点规则。隔离浏览器使用实际主题验证，点击后的 outline-style=none，键盘 Tab 聚焦为 rgb(0,102,255) solid 2px；仅切换本地模拟开关，没有修改真实任务。693 项测试与两种架构构建通过。

已 SSH 更新 NAS，运行 0.3.1/登记 0.2.52，保留数据和暂停状态；任务、能力、偏好及命令目录接口 200，数据库完整性 ok/外键无异常。最终前端 SHA-256 `d3ffb6b34d9b4fdde2c08b2837aae26a69d905c43b15a8c844ab6d4a979b6b47`，x64 包 `21b98b8eecb76bc0379e8ab107c9e98de892a55f8e84f4cf997880048776107c`，ARM64 包 `51023f69709478a0fc0e846d82a3f659519a6589a0d2ded289e41fc9528a908e`。ARM64 未真机验收。

## WebView 触摸高亮补齐

用户补充为“按下后切换状态时显示”。上一次验证覆盖鼠标焦点，没有证明实体触摸效果；代码也确实缺少触摸高亮处理。Chrome 官方说明系统触摸高亮与 outline 是两层：<https://developer.chrome.com/docs/webview/tips#system_highlights>。

公共开关及其后代显式设置 -webkit-tap-highlight-color:transparent，同时补充 touchstart/mousedown capture，兼容没有 Pointer 事件的触摸路径。触摸事件测试验证触摸后 focus 不设置键盘焦点标记，键盘操作仍设置。694 项完整测试、类型/契约/Lint/格式和两种架构构建通过。当前 adb 无连接设备，因此不宣称本轮已在实体手机复现或验收。

SSH 更新完成，运行 0.3.1/登记 0.2.52。NAS 浏览器计算结果：公共外层、Semi 外层、原生 input 三层 -webkit-tap-highlight-color 均为 rgba(0,0,0,0)，outline-style 均 none；任务 API 200，完整性 ok/外键无异常，真实任务 enabled=0 未改动。前端 SHA-256 `c504429726d62c30b756e54fef58f79fea25ea2e62d92b55d1c17877e3054379`。旧的 App 窗口不会自动替换已加载 JavaScript，需关闭窗口后重新打开再做手机触摸复测。

## 真机确认：禁用原生输入框被通用样式显示

手机 ADB 连通后，在飞牛 App 内实际复现了 loading 阶段蓝色矩形。此前焦点/tap-highlight 的推断没有完整解释实体设备现象。

直接原因是 dialogs.css 的 input[type=checkbox]:disabled {opacity:0.5}，其优先级覆盖 Semi .semi-switch-native-control {opacity:0}，使 loading 时被禁用、原本隐藏的原生复选框显露出来。通用 checkbox 的边框、checked、hover、disabled 等选择器现排除 .semi-switch-native-control，让公共组件拥有自己的内部输入样式；不通过新增开关皮肤掩盖冲突。

实测同一 CSS 顺序下，修复前禁用原生输入 opacity=0.5，修复后=0，普通表单禁用复选框仍为 0.5。新增样式边界回归覆盖 checked/disabled 四种组合，695 项完整测试通过。真机使用安排在 2099 年的临时无害脚本任务，避免执行用户的真实程序任务。

## 清理无效规避代码（2026-10-25）

用户真机复测已确认蓝色边框消失。随后按要求移除前两轮基于推测增加的指针/触摸/键盘焦点状态、事件捕获、自定义焦点外框及 tap-highlight 强制覆盖，同时删除只验证该规避实现的测试；恢复 Semi 原生键盘焦点行为。保留稳定加载基线的公共 inline-flex 容器，以及通用 checkbox 样式排除 Semi 内部输入框的根因修复和对应回归测试。

清理后 694 项完整测试通过，Lint、Prettier、类型检查和 x64/ARM64 构建成功。遵照用户本次要求，不再连接手机验收。

已通过 SSH 停止、替换 dist、启动完成更新，运行版本 0.3.1，应用中心登记仍为 0.2.52。15 个关键读取接口返回 200；SQLite schema22、integrity_check=ok、foreign_key_check 无异常。此前临时诊断任务（2099 年单次执行，实际运行记录为 0）已通过任务 API 删除；用户原任务 test 的 enabled=1 保持不变。前端 SHA-256 为 `0638cd54d12cb24f3cb524abb3623e61f06146aaaeebbffc468df264223535d0`，与 NAS 文件一致。x64 包 SHA-256 `1dabd0b9e43461af204f8d80205765978795cd4b0954dd8749f2fe02b2eae5f8`；ARM64 包 `eeccdd77e0bf3694a01b931297dcad2d3daba0b34200babb9ac6e0f1eaf06029`。本轮未连接手机，也未向 x64 NAS 部署 ARM 文件。
