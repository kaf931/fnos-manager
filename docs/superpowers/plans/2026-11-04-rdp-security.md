# RDP 安全与证书配置

按用户已确认的开源实现方案补齐功能，不增加独立样式。

- [x] 为连接增加 security（any/nla/tls/rdp）和 certificatePolicy（strict/tofu/ignore）。新连接 any+strict，旧连接迁移保留 nla+strict。
- [x] 测试参数映射、API枚举校验、保存和旧客户端更新保留配置、备份恢复、数据库26→27。
- [x] 复用 NativeSelect、task-form-body 和公共说明文字，明确首次自动信任与忽略校验含义。
- [x] guacd 的 HOME/XDG_CONFIG_HOME 指向应用数据下700权限目录；使用现有 FreeRDP TOFU，不自行实现证书绕过。
- [x] 日志报告实际安全和证书策略，移除固定 NLA/校验启用的误导信息。
- [x] 全量测试、构建与 lint；SSH保留数据部署并检查接口、数据库和配置数量。

参考：Guacamole 官方 RDP 参数说明、Remmina rdp_plugin.c、FreeRDP /cert 参数。首次信任自动接受未知证书，后续匹配检查；信任记录不随配置备份导出。暂不新增指纹编辑或证书确认弹窗。

完成：全量842测试、生产构建、ESLint与NAS真实证书协商测试通过；NAS运行版本号仍0.3.6，双架构0.3.7包已重打并验证schema27。
