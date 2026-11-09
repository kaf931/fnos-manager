# 2026-11-09 消息通知菜单与渠道补全

运行版本保持 0.4.2。本记录接续同日第一轮通知渠道扩展。

## 功能和布局

- 新增 Bark、PushPlus、Server酱、WxPusher、ntfy、Gotify、Slack、Discord，连同原五个渠道共 13 种，每个账号选择一个渠道。
- Server酱支持 SCT 与 sctp SendKey；WxPusher 支持 SPT 与 AppToken／UID。Bark、ntfy、Gotify 支持自建服务地址。
- 按平台检查业务确认；Discord 请求等待响应，Slack 检查文本确认；部分 UID 失败会记录失败。投递记录成功文案为“已接收”，不等同于接收设备已收到消息。
- 桌面主导航新增“消息通知”；移动端通过“更多”进入。系统设置移除原通知入口与弹窗实现。投递记录沿用应用清理中的统一列表。
- 复用公共 toolbar、system-settings-content、system-settings-section、task-form-body、system-settings-row、form-check-row、NativeSelect、PasswordField 和公共导航图标。没有新增通知页面专用 CSS；移动端仅扩展现有导航隐藏规则。
- 移除卡片底部重复的小字说明。通知条件行沿用公共设置行的高度与内边距。
- 无新增数据库迁移，读取旧 notification_options JSON 时补齐新字段默认值。

## 验证

- 完整回归 **980/980 通过**。修正一处同毫秒创建两条记录时测试依赖排序的断言，改为按任务 ID 检查实际结果。
- 最后公共设置行布局调整后，UI／导航／外观相关 **10/10 通过**；类型检查、前端契约、生产构建、lint、git diff --check 通过。构建仍有既有 vendor chunk 大小提示。
- 八种新渠道的请求格式、鉴权、模板、平台确认、必填字段、设置读写、旧 JSON 默认值均有测试；可自定义地址的五种新渠道通过本地 HTTP 接收端验证完整请求与响应处理。
- NAS 浏览器确认 13 个渠道选项、Bark 专用字段、ntfy Topic 长度、折叠高级配置、移动端更多入口。375×720 下页面宽度／滚动宽度均为 375px，无横向溢出；展开高级配置后表单内部滚动。最终设置行高 64px，padding 为公共 12px 0。
- 浏览器未保存测试配置，也未触发外部测试通知。未提供各平台真实凭据，未完成真实群聊或手机推送验收。
- 最终截图：`notification-all-channels-2026-11-09/desktop.png`、`notification-all-channels-2026-11-09/mobile.png`。

## NAS 更新

- 更新前 SQLite 一致性备份：`/tmp/notification-pre-schema30-1794236017298.sqlite`。
- SSH 停止、备份、替换运行文件、启动；最终运行文件备份：`/tmp/adb-runtime-backup.sie8IU`。未经过应用中心安装流程，登记版本未改。
- 实际运行版本 0.4.2，关键接口 HTTP 200；schema30、integrity_check=ok、外键错误 0。原通知配置摘要未改变，当前配置为 0 行；其他配置计数不变，ADB 连接保留 1 条，无活动 scrcpy 或任务 Docker 构建。
- 本轮未重新生成 FPK；既有 0.4.2 安装包不包含本轮通知扩展。
