# 桌面入口安装卷

测试设备日志明确提示 Use --volume to specify the volume index：该设备未设置CLI默认安装卷，旧版调用install-fpk时未传volume。生成入口FPK本身不依赖默认卷。

修复后新入口从NAS管家target实际路径确定/volN/@appcenter中的N，显式执行install-fpk --volume N；更新已有入口和失败回滚沿用旧入口所在卷。解析发生在卸载旧入口前，无法确定卷号即停止并显示明确错误。不修改系统全局默认卷。可预期的安装失败改为安全DomainError，避免统一变成无信息的内部错误。

飞牛界面入口：应用中心→左下角设置→应用下载和安装位置。CLI查看为appcenter-cli default-volume；配置为sudo appcenter-cli default-volume 1（1表示第一个存储卷，必须按实际设备选择）。CLI帮助现场确认install-fpk支持-v/--volume参数。当前NAS界面和CLI均为存储空间1，仅查看未修改。

旧版可点击图标卡片的下载入口安装包，再到应用中心手动安装并明确选择存储卷，绕过CLI默认卷缺失。测试人员的另一台NAS尚需复测；当前NAS已验证显式卷号1的临时快捷入口安装成功并清理，未动真实图标与应用数据。
