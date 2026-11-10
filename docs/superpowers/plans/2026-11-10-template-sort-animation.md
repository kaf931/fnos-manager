# 通知模板拖拽动画实施计划

**目标：** 拖动卡片跟随指针、相邻卡片平滑让位、松手落位，保留公共样式和当前账号的持久化顺序。

**方案：** 采用 dnd-kit 当前 React 排序 API，删除现有手写指针拖动；排序只在拖动完成后调用现有 onMove，取消不写入。复用 CompactCard 和左侧九点把手，动画约 220ms；遵守 prefers-reduced-motion，保留手机长按和键盘可操作性。服务端及数据库不变。

- [x] 阅读当前官方 API 与安装包类型，明确传感器、排序与落位动画的配置。
- [x] 修改共享 SortableCards 接入排序、把手与动画，保留现有卡片内容和持久化接口。
- [x] 调整通知界面测试以驱动 dnd-kit 完成事件，覆盖保存、取消、回退、禁用及键盘操作；真实浏览器验证跟随、让位及落位。
- [x] 执行全量测试、构建及代码检查。
- [x] SSH 保留数据更新 NAS，校验服务、版本、关键接口与数据库，记录结果并提交推送。

官方参考：https://dndkit.com/react/hooks/use-sortable/ 、https://dndkit.com/react/components/drag-overlay/ 、https://dndkit.com/react/guides/sortable-state-management/
